require "test_helper"

class SignalNormalizerTest < ActiveSupport::TestCase
  test "describes a gaming PC" do
    profile = profile_for(GAMING_PC)

    assert_equal :computer, profile.facts[:device_class]
    assert profile.facts[:gaming_gpu]
    assert profile.facts[:gamepad]
    assert_match "Windows", profile.state[:device]
    assert_match "RTX 4070", profile.state[:graphics]
    assert_equal "02:14 on Tuesday", profile.state[:local_time]
    assert_match "144 Hz", profile.state[:display]
  end

  test "describes a phone" do
    profile = profile_for(IPHONE)

    assert_equal :phone, profile.facts[:device_class]
    assert_equal "iOS", profile.facts[:os]
    assert_match "touchscreen", profile.state[:input]
  end

  test "adds location and network from geo" do
    geo = GeoLookup::Result.new(city: "Providence", country: "United States", country_code: "US",
                                network_type: :university, organization: "Brown University")
    profile = profile_for(IPHONE, geo: geo)

    assert_equal "Providence, United States", profile.state[:location]
    assert_equal "university (Brown University)", profile.state[:network]
    assert_equal :university, profile.facts[:network_type]
  end

  test "summarises behaviour" do
    behavior = {
      "pointer" => { "samples" => 200, "avgSpeed" => 1900.0, "turniness" => 0.2 },
      "scroll" => { "kind" => "wheel" },
      "typing" => { "keys" => 12, "meanIntervalMs" => 110.0, "backspaces" => 1 },
      "blurs" => 2
    }
    profile = profile_for(GAMING_PC, behavior: behavior)

    assert_match "fast, smooth", profile.state[:pointer_movement]
    assert_equal "with a notched mouse wheel", profile.state[:scrolling]
    assert_match "12 keys", profile.state[:typing]
  end

  test "survives hostile or malformed input" do
    hostile = { "ua" => [ "x" ], "gpu" => "a" * 5000, "cores" => "many", "screen" => "big",
                "languages" => { "a" => 1 }, "localTime" => { "hour" => 99 }, "fonts" => [ 1, nil, "Inter\u0000\n" ] }

    profile = profile_for(hostile, behavior: "nope")

    assert_operator profile.state[:graphics].length, :<=, 120
    assert_nil profile.state[:local_time]
    assert_equal "Inter", profile.state[:notable_fonts_installed]
    assert_nothing_raised { profile_for(nil) }
  end
end
