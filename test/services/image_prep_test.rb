require "test_helper"

class ImagePrepTest < ActiveSupport::TestCase
  Info = ImageProbe::Info

  def plan_for(width, height, format: "jpeg")
    ImagePrep::Plan.for(Info.new(format: format, width: width, height: height, animated: false))
  end

  def assert_within_limits(plan)
    assert plan.width.between?(ImagePrep::MIN_SIDE, ImagePrep::MAX_SIDE), "width #{plan.width} out of range"
    assert plan.height.between?(ImagePrep::MIN_SIDE, ImagePrep::MAX_SIDE), "height #{plan.height} out of range"
    total = plan.width * plan.height
    assert total.between?(ImagePrep::MIN_PIXELS, ImagePrep::MAX_PIXELS), "total #{total} out of range"
  end

  test "an in-range image is left unchanged" do
    plan = plan_for(447, 447)

    assert_equal [ 447, 447 ], [ plan.width, plan.height ]
    assert_not plan.changes?
  end

  test "downscales an oversized image, keeping aspect ratio and limits" do
    plan = plan_for(4000, 3000)

    assert plan.changes?
    assert_within_limits(plan)
    assert_in_delta 4000.0 / 3000, plan.width.to_f / plan.height, 0.02
    assert_equal ImagePrep::MAX_SIDE, plan.width
  end

  test "upscales a tiny image to reach the pixel floor" do
    plan = plan_for(100, 100)

    assert plan.changes?
    assert_within_limits(plan)
    assert_operator plan.width * plan.height, :>=, ImagePrep::MIN_PIXELS
  end

  test "caps total pixels for a large near-square image" do
    plan = plan_for(1568, 1568)

    assert_within_limits(plan)
    assert_operator plan.width * plan.height, :<=, ImagePrep::MAX_PIXELS
  end

  test "a format rename counts as a change" do
    assert plan_for(500, 500, format: "jpg").changes?
  end

  test "rejects an extreme aspect ratio" do
    error = assert_raises(ImagePrep::Invalid) { plan_for(3000, 300) }
    assert_match "long and thin", error.message
  end

  test "every plausible size lands within the limits or is rejected for ratio" do
    [ [ 280, 280 ], [ 1568, 1568 ], [ 320, 240 ], [ 6000, 4000 ], [ 150, 1200 ], [ 1920, 1080 ], [ 50, 50 ] ].each do |w, h|
      begin
        assert_within_limits(plan_for(w, h))
      rescue ImagePrep::Invalid
        assert_operator [ w, h ].max.to_f / [ w, h ].min, :>, ImagePrep::MAX_RATIO
      end
    end
  end

  test "prepare rejects non-images, oversize and animated input" do
    assert_raises(ImagePrep::Invalid) { ImagePrep.prepare("not an image") }
    assert_raises(ImagePrep::Invalid) { ImagePrep.prepare("x" * (ImagePrep::MAX_BYTES + 1)) }
  end

  test "prepare passes a within-limits image through when no backend is installed" do
    skip "libvips installed; passthrough path not exercised" if ImagePrep.available?
    bytes = crafted_png(447, 447)

    result = ImagePrep.prepare(bytes, content_type: "image/png")

    assert_not result.converted
    assert_equal bytes, result.bytes
    assert_equal "image/png", result.content_type
  end
end
