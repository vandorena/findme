# Reads an image's real format and dimensions straight from its header bytes,
# with no image library, so uploads can be validated before anything heavier is
# loaded. Trusts the bytes, not the declared content type. Covers exactly what
# TypeSafe accepts: still PNG and JPEG.
module ImageProbe
  Info = Data.define(:format, :width, :height, :animated)

  PNG_SIGNATURE = "\x89PNG\r\n\x1a\n".b.freeze
  # JPEG start-of-frame markers carry the dimensions; these three in the 0xC0-0xCF
  # range do not (Huffman table, arithmetic coding, define arithmetic conditioning).
  JPEG_NON_SOF = [ 0xC4, 0xC8, 0xCC ].freeze

  module_function

  # Returns an Info, or nil if the bytes are not a PNG or JPEG we can read.
  def call(bytes)
    data = bytes.to_s.b
    png(data) || jpeg(data)
  end

  def png(data)
    return nil unless data.start_with?(PNG_SIGNATURE)
    ihdr = data.index("IHDR".b)
    return nil unless ihdr && data.bytesize >= ihdr + 12
    width, height = data.byteslice(ihdr + 4, 8).unpack("N2")
    return nil if width.nil? || height.nil? || width.zero? || height.zero?

    # An acTL chunk before the first frame means an animated PNG.
    actl = data.index("acTL".b)
    idat = data.index("IDAT".b)
    animated = !actl.nil? && (idat.nil? || actl < idat)
    Info.new(format: "png", width: width, height: height, animated: animated)
  end

  def jpeg(data)
    return nil unless data.getbyte(0) == 0xFF && data.getbyte(1) == 0xD8
    i = 2
    limit = data.bytesize
    while i + 9 < limit
      return nil unless data.getbyte(i) == 0xFF
      marker = data.getbyte(i + 1)
      i += 2
      next if marker == 0xFF # fill bytes
      break if marker == 0xD9 || marker == 0xDA # end of image / start of scan

      length = data.byteslice(i, 2).unpack1("n").to_i
      break if length < 2
      if marker.between?(0xC0, 0xCF) && !JPEG_NON_SOF.include?(marker)
        height, width = data.byteslice(i + 3, 4).unpack("n2")
        return nil if width.nil? || height.nil? || width.zero? || height.zero?
        return Info.new(format: "jpeg", width: width, height: height, animated: false)
      end
      i += length
    end
    nil
  end
end
