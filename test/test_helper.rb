ENV["RAILS_ENV"] ||= "test"
ENV.delete("TYPESAFE_API_KEY") # tests never call the live API
require_relative "../config/environment"
require "rails/test_help"

module ActiveSupport
  class TestCase
    # Run tests in parallel with specified workers
    parallelize(workers: :number_of_processors)

    GAMING_PC = {
      "ua" => "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
      "uaData" => { "platform" => "Windows", "platformVersion" => "15.0.0", "mobile" => false },
      "gpu" => "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)",
      "cores" => 16, "memory" => 8, "touchPoints" => 0, "hz" => 144,
      "screen" => { "w" => 2560, "h" => 1440, "dpr" => 1 }, "window" => { "w" => 2560, "h" => 1300 },
      "darkMode" => true, "languages" => [ "en-US" ], "timezone" => "America/New_York",
      "localTime" => { "hour" => 2, "minute" => 14, "weekday" => 2 },
      "gamepads" => [ "Xbox Wireless Controller" ], "fonts" => [ "Segoe UI", "Calibri" ]
    }.freeze

    IPHONE = {
      "ua" => "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1",
      "gpu" => "Apple GPU", "touchPoints" => 5, "hz" => 60,
      "screen" => { "w" => 393, "h" => 852, "dpr" => 3 }, "window" => { "w" => 393, "h" => 700 },
      "darkMode" => false, "languages" => [ "en-GB" ],
      "localTime" => { "hour" => 11, "minute" => 5, "weekday" => 6 }
    }.freeze

    def profile_for(signals, behavior: nil, geo: nil)
      SignalNormalizer.new(signals: signals, behavior: behavior, geo: geo).call
    end

    # A structurally valid (not visually meaningful) PNG with real IHDR
    # dimensions, for probe/prep tests that need no actual pixels.
    def crafted_png(width, height)
      chunk = ->(type, data) { [ data.bytesize ].pack("N") + type.b + data.b + [ 0 ].pack("N") }
      ImageProbe::PNG_SIGNATURE.dup <<
        chunk.("IHDR", [ width, height ].pack("N2") + "\x08\x02\x00\x00\x00".b) <<
        chunk.("IDAT", "\x00".b) << chunk.("IEND", "".b)
    end
  end
end
