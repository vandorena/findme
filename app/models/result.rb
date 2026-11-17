# How far off one hunt was. Distances are rounded to 10 m so a row cannot be walked back to a doorstep
# even next to the (unstored) guess.
class Result < ApplicationRecord
  TIERS = %w[doppler mains ip].freeze

  validates :tier, inclusion: { in: TIERS }
  validates :error_m, :ip_error_m, :listened_s, :cap_s, numericality: { greater_than_or_equal_to: 0 }

  def self.round_m(meters)
    (meters / 10.0).round * 10
  end

  def audio_won?
    error_m < ip_error_m
  end
end
