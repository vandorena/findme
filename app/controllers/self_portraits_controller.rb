# Consented self-portrait: a signed-in visitor hands us their own photo, Jev
# reads its visible features, and we return the nearest synthetic twin from the
# bank. The image is read in memory and discarded; nothing is written to disk
# or the database, and the only person who can be the subject is whoever is
# signed in.
class SelfPortraitsController < ApplicationController
  MAX_BYTES = ImagePrep::MAX_BYTES
  TYPES = %w[image/png image/jpeg].freeze

  before_action :require_identity, only: :create

  def show
    @identity = session[:identity]
  end

  def create
    upload = params[:photo]
    return render(json: { error: "attach a PNG or JPEG photo of yourself" }, status: :unprocessable_entity) unless valid?(upload)

    bytes = upload.read(MAX_BYTES + 1)
    return render(json: { error: "photo is too large" }, status: :unprocessable_entity) if bytes.nil? || bytes.bytesize > MAX_BYTES

    prepared = prepare(bytes, upload.content_type)
    return render(json: { error: @prep_error }, status: :unprocessable_entity) if prepared.nil?

    features = FaceFeatures.default.call(prepared.bytes, content_type: prepared.content_type)
    bank = PortraitBank.instance
    match = PortraitMatcher.new(bank).call_observed(features.tags, seed: seed, current: integer(params[:current]))

    render json: {
      portrait: {
        id: match.index,
        width: PortraitBank::WIDTH,
        height: PortraitBank::HEIGHT,
        grid: Base64.strict_encode64(bank.grid(match.index))
      },
      source: features.source,
      confidence: 1.0,
      guesses: read_features(features.tags),
      signals: { "subject" => "your photo", "read_by" => features.source == "jev" ? "TypeSafe" : "placeholder (model not connected)" }
    }
  ensure
    bytes&.clear
  end

  private

  # Validate and (when a backend is installed) normalise the photo to TypeSafe's
  # image limits. Returns nil and sets @prep_error on a rejection the visitor can
  # fix; until libvips is installed, an image that only needs resizing falls back
  # to its raw bytes so the current flow keeps working.
  def prepare(bytes, content_type)
    ImagePrep.prepare(bytes, content_type: content_type)
  rescue ImagePrep::Invalid => e
    @prep_error = e.message
    nil
  rescue ImagePrep::BackendMissing => e
    Rails.logger.info("ImagePrep passthrough: #{e.message}")
    ImagePrep::Result.new(bytes: bytes, content_type: content_type, width: nil, height: nil, converted: false)
  end

  def valid?(upload)
    upload.respond_to?(:read) && upload.respond_to?(:content_type) && TYPES.include?(upload.content_type)
  end

  def read_features(tags)
    rows = [
      pick("age", tags["age_band"], Traits::AGE_BANDS),
      pick("presents as", tags["gender"], Traits::GENDERS),
      pick("background", tags["ethnicity"], Traits::ETHNICITIES),
      pick("expression", tags["expression"], PlaceholderFaces::EXPRESSIONS.to_h { |e| [ e, e.capitalize ] })
    ]
    %w[glasses facial_hair headphones].each do |feature|
      p = tags[feature]
      rows << { trait: feature.tr("_", " "), label: p >= 0.5 ? "yes" : "no", p: [ p, 1 - p ].max.round(3), unsure: !Traits.determined?(p) }
    end
    rows
  end

  def pick(name, distribution, labels)
    option, p = Traits.top(distribution)
    { trait: name, label: labels.fetch(option), p: p.round(3), unsure: p < 1.5 / labels.size }
  end

  def require_identity
    return if session[:identity].present?
    respond_to do |format|
      format.html { redirect_to self_portrait_path }
      format.json { render json: { error: "sign in first" }, status: :unauthorized }
    end
  end

  def seed
    integer(params[:seed]) || session[:identity]["name"].hash & 0x7fffffff
  end

  def integer(value)
    Integer(value, exception: false)
  end
end
