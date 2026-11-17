require "test_helper"

class ResultsPageTest < ActionDispatch::IntegrationTest
  test "empty" do
    get results_path

    assert_response :success
    assert_match "No results yet", response.body
  end

  test "keeps score by tier" do
    base = { confidence: 0, listened_s: 180, cap_s: 180 }
    Result.create!(base.merge(tier: "doppler", error_m: 200, ip_error_m: 8000))
    Result.create!(base.merge(tier: "doppler", error_m: 9000, ip_error_m: 3000))
    Result.create!(base.merge(tier: "ip", error_m: 5000, ip_error_m: 5000))
    get results_path

    assert_response :success
    assert_match(/planes \(Doppler\)\s+2\s+4\.6 km\s+5\.5 km\s+50%\s+50%/, response.body)
    assert_match(/all\s+3\s+5\.0 km/, response.body)
  end
end
