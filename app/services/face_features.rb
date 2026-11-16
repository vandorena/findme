# Reads the visible features of a face image and returns them in the same tag
# shape the portrait bank stores, so a real photo can be matched tag-to-tag
# against the synthetic twins. This genuinely needs the model: there is no
# rule-of-thumb that can read a face, so without a key the Fake stands in.
class FaceFeatures
  Result = Data.define(:tags, :source)

  # `photo` is the image reference in the request state (see JevClient#ask_about_image).
  SUBJECT = "The image `photo` is one person's face."

  def self.default
    JevClient.from_env ? new(JevClient.from_env) : Fake.new
  end

  def initialize(client)
    @client = client
  end

  def call(image_bytes, content_type:)
    answers = @client.ask_about_image(
      image: image_bytes, content_type: content_type, questions: questions
    )
    Result.new(tags: parse(answers), source: "jev")
  rescue JevClient::Error => e
    Rails.logger.warn("Jev image read failed: #{e.message}")
    Fake.new.call(image_bytes, content_type: content_type)
  end

  def questions
    {
      "age_band" => choice("#{SUBJECT} Which age band is this person in?", Traits::AGE_BANDS),
      "gender" => choice("#{SUBJECT} How does this person present?", Traits::GENDERS),
      "ethnicity" => choice("#{SUBJECT} What is this person's ethnic background?", Traits::ETHNICITIES),
      "expression" => choice("#{SUBJECT} What is this person's expression?", PlaceholderFaces::EXPRESSIONS.to_h { |e| [ e, e ] }),
      "glasses" => noul("#{SUBJECT} This person is wearing glasses."),
      "facial_hair" => noul("#{SUBJECT} This person has visible facial hair."),
      "headphones" => noul("#{SUBJECT} This person is wearing headphones or a headset.")
    }
  end

  def parse(answers)
    {
      "age_band" => distribution(answers, "age_band", Traits::AGE_BANDS.keys),
      "gender" => distribution(answers, "gender", Traits::GENDERS.keys),
      "ethnicity" => distribution(answers, "ethnicity", Traits::ETHNICITIES.keys),
      "expression" => distribution(answers, "expression", PlaceholderFaces::EXPRESSIONS),
      "glasses" => probability(answers, "glasses"),
      "facial_hair" => probability(answers, "facial_hair"),
      "headphones" => probability(answers, "headphones")
    }
  rescue KeyError, TypeError, ArgumentError, NoMethodError => e
    raise JevClient::Error, "unexpected image answer shape: #{e.message}"
  end

  private

  def choice(instructions, options)
    { type: "choice", instructions: instructions, criteria: options }
  end

  def noul(instructions)
    { type: "noul", instructions: instructions }
  end

  def distribution(answers, key, keys)
    given = answers.fetch(key).fetch("probabilities")
    Traits.normalize(keys.to_h { |option| [ option, Float(given.fetch(option, 0.0)) ] })
  end

  def probability(answers, key)
    Float(answers.fetch(key).fetch("noul")).clamp(0.0, 1.0)
  end

  # Stand-in used in development and whenever the model is unavailable. It can't
  # actually see the image, so it returns a stable pseudo-random reading derived
  # from the bytes: enough to exercise matching and the morph end to end.
  class Fake
    def call(image_bytes, content_type: nil)
      rng = Random.new(Digest::MD5.hexdigest(image_bytes.to_s).to_i(16) % (2**32))
      face = PlaceholderFaces.sample(0, rng)
      tags = PlaceholderFaces.tags(face).except("id")
      Result.new(tags: tags, source: "placeholder")
    end
  end
end
