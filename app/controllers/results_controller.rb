# Public scoreboard: does the microphone ever beat the IP address?
class ResultsController < ApplicationController
  def index
    @total = Result.count
    @tiers = Result::TIERS.to_h { |tier| [ tier, summarize(Result.where(tier:)) ] }
    @all = summarize(Result.all)
  end

  private

  def summarize(scope)
    errors = scope.pluck(:error_m, :ip_error_m)
    return nil if errors.empty?

    ours, ip = errors.transpose
    {
      count: errors.size,
      median_m: median(ours),
      ip_median_m: median(ip),
      within_1km: ours.count { it <= 1000 },
      audio_won: errors.count { |o, i| o < i }
    }
  end

  def median(values)
    sorted = values.sort
    mid = sorted.size / 2
    sorted.size.odd? ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  end
end
