# Shared trait taxonomy. Visitor guesses and portrait tags use the same keys so
# they can be compared directly.
module Traits
  AGE_BANDS = {
    "under_18" => "Under 18",
    "18_24" => "18 to 24",
    "25_34" => "25 to 34",
    "35_49" => "35 to 49",
    "50_64" => "50 to 64",
    "65_plus" => "65 or older"
  }.freeze

  GENDERS = {
    "masculine" => "Presents as a man",
    "feminine" => "Presents as a woman"
  }.freeze

  ETHNICITIES = {
    "white" => "White / European descent",
    "black" => "Black / African descent",
    "east_asian" => "East Asian",
    "south_asian" => "South Asian",
    "southeast_asian" => "Southeast Asian",
    "middle_eastern" => "Middle Eastern or North African",
    "latino" => "Latino / Hispanic"
  }.freeze

  ARCHETYPES = {
    "gamer" => "Plays PC or console games as a main hobby",
    "software_developer" => "Writes software for work or study",
    "designer_creative" => "Designer, artist, video or music creator",
    "student" => "School or university student",
    "office_professional" => "Office worker on a managed work computer",
    "finance" => "Works in finance or trading",
    "casual_phone_browser" => "Casually browsing on a phone",
    "privacy_enthusiast" => "Goes out of their way to avoid tracking",
    "retiree" => "Retired, uses the device for news, email and family"
  }.freeze

  NOULS = {
    "plays_games" => "This person regularly plays video games.",
    "headphones" => "This person is wearing headphones right now.",
    "night_owl" => "This person habitually stays up late at night.",
    "works_in_tech" => "This person works in or studies a technical field.",
    "work_device" => "This device is owned or managed by an employer or school."
  }.freeze

  # A noul inside this range means the state does not settle the question.
  UNDETERMINED = (0.3..0.7)

  module_function

  def determined?(probability)
    !UNDETERMINED.cover?(probability)
  end

  def uniform(keys)
    keys.to_h { |k| [ k, 1.0 / keys.size ] }
  end

  def normalize(weights)
    total = weights.values.sum
    return uniform(weights.keys) unless total.positive?
    weights.transform_values { |v| v / total }
  end

  # 0 for a flat distribution, 1 when all mass is on one option.
  def sharpness(distribution)
    n = distribution.size
    return 1.0 if n <= 1
    entropy = distribution.values.sum { |p| p.positive? ? -p * Math.log(p) : 0.0 }
    (1.0 - entropy / Math.log(n)).clamp(0.0, 1.0)
  end

  def top(distribution)
    distribution.max_by { |_, p| p }
  end
end
