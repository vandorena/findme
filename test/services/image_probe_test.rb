require "test_helper"

class ImageProbeTest < ActiveSupport::TestCase
  def chunk(type, data)
    [ data.bytesize ].pack("N") + type.b + data.b + [ 0 ].pack("N")
  end

  def png(width, height, apng: false)
    body = ImageProbe::PNG_SIGNATURE.dup
    body << chunk("IHDR", [ width, height ].pack("N2") + "\x08\x02\x00\x00\x00".b)
    body << chunk("acTL", [ 1, 0 ].pack("N2")) if apng
    body << chunk("IDAT", "\x00".b)
    body << chunk("IEND", "".b)
    body
  end

  def jpeg(width, height)
    sof = "\xFF\xC0".b + [ 17 ].pack("n") + "\x08".b + [ height, width ].pack("n2") + ("\x01" * 9).b
    "\xFF\xD8".b + "\xFF\xE0".b + [ 16 ].pack("n") + ("JFIF\x00".b + "\x00" * 9) + sof + "\xFF\xD9".b
  end

  test "reads PNG dimensions" do
    info = ImageProbe.call(png(640, 480))

    assert_equal "png", info.format
    assert_equal 640, info.width
    assert_equal 480, info.height
    assert_not info.animated
  end

  test "flags an animated PNG" do
    assert ImageProbe.call(png(100, 100, apng: true)).animated
  end

  test "reads JPEG dimensions past an application segment" do
    info = ImageProbe.call(jpeg(1200, 900))

    assert_equal "jpeg", info.format
    assert_equal 1200, info.width
    assert_equal 900, info.height
  end

  test "returns nil for non-images and truncated data" do
    assert_nil ImageProbe.call("GIF89a........")
    assert_nil ImageProbe.call("")
    assert_nil ImageProbe.call(ImageProbe::PNG_SIGNATURE.dup)
  end
end
