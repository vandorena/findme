# Turns an uploaded photo into one that satisfies TypeSafe's image limits, so a
# visitor's upload is ready to send as a Jev image asset.
#
# What is pure Ruby and runs now: validating format, size and animation, and
# planning the exact output dimensions (ImagePrep::Plan). What needs a backend:
# the actual pixel resize/transcode, done by libvips, which is loaded lazily so
# the app runs without it. Until a backend is installed, an image that is
# already within limits passes through untouched; one that needs resizing is
# reported as such rather than silently sent oversize.
#
# Limits (https://docs.typesafe.ai/images.md):
#   PNG or JPEG, still only · <= 16 MiB per image · 280-1568 px each side ·
#   78,400-2,458,624 total pixels.
module ImagePrep
  class Invalid < StandardError; end
  class BackendMissing < StandardError; end

  MAX_BYTES = 16 * 1024 * 1024
  MIN_SIDE = 280
  MAX_SIDE = 1568
  MIN_PIXELS = 78_400
  MAX_PIXELS = 2_458_624
  MAX_RATIO = MAX_SIDE.to_f / MIN_SIDE # 5.6; past this no scaling fits both sides

  Result = Data.define(:bytes, :content_type, :width, :height, :converted)

  module_function

  # Validate and, when a backend is available and needed, convert. Raises
  # ImagePrep::Invalid with a human-readable reason for anything unfixable.
  def prepare(bytes, content_type: nil)
    data = bytes.to_s.b
    raise Invalid, "the photo is larger than 16 MiB" if data.bytesize > MAX_BYTES

    info = ImageProbe.call(data)
    raise Invalid, "only PNG or JPEG photos are supported" if info.nil?
    raise Invalid, "animated images are not supported" if info.animated

    plan = Plan.for(info)

    if plan.changes? && backend
      converted = backend.render(data, plan)
      Result.new(bytes: converted, content_type: "image/#{plan.format}", width: plan.width, height: plan.height, converted: true)
    elsif plan.changes?
      raise BackendMissing, "the photo needs resizing (#{info.width}x#{info.height} -> #{plan.width}x#{plan.height}) but no image backend is installed"
    else
      Result.new(bytes: data, content_type: "image/#{info.format}", width: info.width, height: info.height, converted: false)
    end
  end

  def available?
    !backend.nil?
  end

  def backend
    return @backend if defined?(@backend)
    @backend = VipsBackend.load
  end

  # The target dimensions and format, computed from the source. Pure arithmetic.
  class Plan
    attr_reader :width, :height, :format, :source_width, :source_height, :source_format

    def self.for(info)
      new(info).tap(&:compute)
    end

    def initialize(info)
      @source_width = info.width
      @source_height = info.height
      @source_format = info.format
      @format = info.format == "jpg" ? "jpeg" : info.format
    end

    def compute
      ratio = [ source_width, source_height ].max.to_f / [ source_width, source_height ].min
      if ratio > MAX_RATIO
        raise Invalid, "the photo is too long and thin (#{source_width}x#{source_height}); crop it closer to square first"
      end

      scale = pick_scale
      @width = (source_width * scale).round.clamp(MIN_SIDE, MAX_SIDE)
      @height = (source_height * scale).round.clamp(MIN_SIDE, MAX_SIDE)
      correct_total
    end

    # True when the bytes must be rewritten: a resize or a format rename.
    def changes?
      width != source_width || height != source_height || format != source_format
    end

    private

    # Prefer leaving the image alone (scale 1); otherwise the gentlest scale that
    # brings every side and the total pixel count inside the allowed range.
    def pick_scale
      area = source_width.to_f * source_height
      upper = [ MAX_SIDE / source_width.to_f, MAX_SIDE / source_height.to_f, Math.sqrt(MAX_PIXELS / area) ].min
      lower = [ MIN_SIDE / source_width.to_f, MIN_SIDE / source_height.to_f, Math.sqrt(MIN_PIXELS / area) ].max
      1.0.clamp(lower, upper)
    end

    # Rounding and clamping can nudge the total just outside the band; walk it back in.
    def correct_total
      10.times do
        total = width * height
        break if total.between?(MIN_PIXELS, MAX_PIXELS)
        factor = Math.sqrt((total < MIN_PIXELS ? MIN_PIXELS : MAX_PIXELS).to_f / total)
        @width = (width * factor).round.clamp(MIN_SIDE, MAX_SIDE)
        @height = (height * factor).round.clamp(MIN_SIDE, MAX_SIDE)
      end
    end
  end

  # Resizes and re-encodes with libvips, loaded only when first needed. Strips
  # metadata (EXIF, GPS) on the way out.
  class VipsBackend
    def self.load
      require "vips"
      new
    rescue LoadError
      nil
    end

    def render(bytes, plan)
      image = Vips::Image.new_from_buffer(bytes, "", access: :sequential)
      image = image.thumbnail_image(plan.width, height: plan.height, size: :force)
      suffix = plan.format == "png" ? ".png" : ".jpg"
      image.write_to_buffer(suffix, strip: true)
    rescue Vips::Error => e
      raise Invalid, "the photo could not be processed: #{e.message}"
    end
  end
end
