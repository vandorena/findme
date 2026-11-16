require "test_helper"

class ProfileFlowTest < ActionDispatch::IntegrationTest
  test "the page loads" do
    get root_path

    assert_response :success
    assert_select "[data-controller=portrait]"
  end

  test "returns a portrait and the evidence behind it" do
    post profile_path, params: { signals: GAMING_PC, behavior: nil, seed: 5, current: nil }, as: :json

    assert_response :success
    body = response.parsed_body
    assert_equal PortraitBank::CELLS, Base64.decode64(body["portrait"]["grid"]).bytesize
    assert_equal "heuristic", body["source"]
    assert body["guesses"].any? { |guess| guess["trait"] == "age" }
    assert_match "RTX 4070", body["signals"]["graphics"]
    assert_match "infer;dur=", response.headers["Server-Timing"]
  end

  test "an empty payload still gets a portrait" do
    post profile_path, params: {}, as: :json

    assert_response :success
    assert response.parsed_body["portrait"]["grid"].present?
  end
end
