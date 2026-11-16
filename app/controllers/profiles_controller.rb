class ProfilesController < ApplicationController
  def show
  end

  # Nothing from this request is stored: signals are normalised, judged,
  # matched to a portrait and discarded.
  def create
    timings = {}
    payload = request.request_parameters

    profile = time(timings, :normalize) do
      SignalNormalizer.new(
        signals: payload["signals"],
        behavior: payload["behavior"],
        geo: GeoLookup.instance.call(request.remote_ip),
        headers: { "Accept-Language" => request.headers["Accept-Language"] }
      ).call
    end
    result = time(timings, :infer) { TraitInference.new.call(profile) }
    bank = PortraitBank.instance
    match = time(timings, :match) do
      PortraitMatcher.new(bank).call(result.traits, seed: integer(payload["seed"]) || 0, current: integer(payload["current"]))
    end

    evidence = Evidence.new(result.traits)
    response.headers["Server-Timing"] = timings.map { |name, ms| "#{name};dur=#{ms.round(1)}" }.join(", ")
    render json: {
      portrait: {
        id: match.index,
        width: PortraitBank::WIDTH,
        height: PortraitBank::HEIGHT,
        grid: Base64.strict_encode64(bank.grid(match.index))
      },
      source: result.source,
      confidence: evidence.confidence,
      guesses: evidence.guesses,
      signals: profile.state
    }
  end

  private

  def time(timings, name)
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    yield
  ensure
    timings[name] = (Process.clock_gettime(Process::CLOCK_MONOTONIC) - started) * 1000
  end

  def integer(value)
    value.is_a?(Integer) ? value : nil
  end
end
