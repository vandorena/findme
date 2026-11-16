require "test_helper"

class FaceFeaturesTest < ActiveSupport::TestCase
  class StubClient
    def initialize(&block) = (@block = block)
    def ask_about_image(**kwargs) = @block.call(**kwargs)
  end

  def jev_image_answers
    spread = ->(keys) { { "probabilities" => keys.each_with_index.to_h { |k, i| [ k, i.zero? ? 0.8 : 0.2 / (keys.size - 1) ] } } }
    {
      "age_band" => spread.(Traits::AGE_BANDS.keys),
      "gender" => spread.(Traits::GENDERS.keys),
      "ethnicity" => spread.(Traits::ETHNICITIES.keys),
      "expression" => spread.(PlaceholderFaces::EXPRESSIONS),
      "glasses" => { "noul" => 0.9 }, "facial_hair" => { "noul" => 0.1 }, "headphones" => { "noul" => 0.05 }
    }
  end

  test "questions cover the bank's visual taxonomy" do
    questions = FaceFeatures.new(StubClient.new).questions

    assert_equal Traits::AGE_BANDS.keys, questions["age_band"][:criteria].keys
    assert_equal PlaceholderFaces::EXPRESSIONS, questions["expression"][:criteria].keys
    assert_equal "noul", questions["glasses"][:type]
  end

  test "parses Jev answers into the bank tag shape" do
    captured = nil
    client = StubClient.new { |image:, content_type:, questions:| captured = { image:, content_type: }; jev_image_answers }
    result = FaceFeatures.new(client).call("JPEGDATA", content_type: "image/jpeg")

    assert_equal "jev", result.source
    assert_equal "JPEGDATA", captured[:image]
    assert_in_delta 0.8, result.tags["age_band"][Traits::AGE_BANDS.keys.first]
    assert_in_delta 1.0, result.tags["gender"].values.sum
    assert_in_delta 0.9, result.tags["glasses"]
  end

  test "falls back to the placeholder reader when the model fails" do
    client = StubClient.new { raise JevClient::Error, "no key" }
    result = FaceFeatures.new(client).call("bytes", content_type: "image/png")

    assert_equal "placeholder", result.source
    assert_in_delta 1.0, result.tags["age_band"].values.sum
    assert_includes PlaceholderFaces::EXPRESSIONS, Traits.top(result.tags["expression"]).first
  end

  test "the placeholder reader is deterministic per image" do
    a = FaceFeatures::Fake.new.call("same", content_type: "image/png")
    b = FaceFeatures::Fake.new.call("same", content_type: "image/png")
    c = FaceFeatures::Fake.new.call("other", content_type: "image/png")

    assert_equal a.tags, b.tags
    assert_not_equal a.tags, c.tags
  end
end
