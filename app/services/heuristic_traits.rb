# Rule-of-thumb guesses in the same shape Jev returns. Used when there is no
# API key or Jev misses the latency budget, so the page always has an answer.
# Deliberately modest: weak evidence leaves distributions close to their priors.
class HeuristicTraits
  AGE_PRIOR = { "under_18" => 0.07, "18_24" => 0.2, "25_34" => 0.27, "35_49" => 0.24, "50_64" => 0.15, "65_plus" => 0.07 }.freeze

  # Very rough population mixes for countries we expect traffic from.
  COUNTRY_ETHNICITY = {
    "US" => { "white" => 0.58, "latino" => 0.19, "black" => 0.12, "east_asian" => 0.04, "south_asian" => 0.03, "southeast_asian" => 0.02, "middle_eastern" => 0.02 },
    "GB" => { "white" => 0.82, "south_asian" => 0.08, "black" => 0.04, "east_asian" => 0.02, "middle_eastern" => 0.02, "southeast_asian" => 0.01, "latino" => 0.01 },
    "IN" => { "south_asian" => 0.97 }, "PK" => { "south_asian" => 0.97 }, "BD" => { "south_asian" => 0.97 },
    "CN" => { "east_asian" => 0.97 }, "JP" => { "east_asian" => 0.97 }, "KR" => { "east_asian" => 0.97 },
    "VN" => { "southeast_asian" => 0.95 }, "PH" => { "southeast_asian" => 0.95 }, "ID" => { "southeast_asian" => 0.95 },
    "NG" => { "black" => 0.97 }, "KE" => { "black" => 0.95 }, "GH" => { "black" => 0.97 },
    "MX" => { "latino" => 0.92 }, "BR" => { "latino" => 0.6, "white" => 0.25, "black" => 0.12 }, "AR" => { "latino" => 0.7, "white" => 0.28 },
    "EG" => { "middle_eastern" => 0.97 }, "SA" => { "middle_eastern" => 0.9 }, "TR" => { "middle_eastern" => 0.8, "white" => 0.18 },
    "DE" => { "white" => 0.86, "middle_eastern" => 0.07 }, "FR" => { "white" => 0.8, "middle_eastern" => 0.09, "black" => 0.06 }
  }.freeze

  def initialize(facts)
    @f = facts
  end

  def call
    {
      age_band: age_band,
      gender: gender,
      ethnicity: ethnicity,
      archetype: archetype,
      gates: { gender: gamer? ? 0.3 : 0.1, ethnicity: country_mix ? 0.4 : 0.05, archetype: archetype_gate },
      nouls: nouls,
      scores: { affluence: affluence, tiredness: tiredness }
    }
  end

  private

  def gamer?
    @f[:gaming_gpu] || @f[:gamepad] || (@f[:hz].to_f > 100 && @f[:os] == "Windows")
  end

  def developer?
    @f[:dev_fonts] || (@f[:os] == "Linux" && @f[:device_class] == :computer)
  end

  def late?
    @f[:hour] && (@f[:hour] >= 23 || @f[:hour] < 5)
  end

  def age_band
    w = AGE_PRIOR.dup
    bump(w, "under_18" => 1.8, "18_24" => 1.7, "25_34" => 1.2, "50_64" => 0.6, "65_plus" => 0.35) if gamer?
    bump(w, "under_18" => 0.5, "18_24" => 2.6, "25_34" => 1.3, "50_64" => 0.5, "65_plus" => 0.2) if @f[:network_type] == :university
    bump(w, "under_18" => 0.3, "25_34" => 1.5, "35_49" => 1.3, "65_plus" => 0.4) if developer?
    bump(w, "under_18" => 1.4, "18_24" => 1.4, "50_64" => 0.7, "65_plus" => 0.5) if late?
    bump(w, "under_18" => 1.3, "18_24" => 1.2, "65_plus" => 0.7) if @f[:dark]
    bump(w, "under_18" => 1.6, "50_64" => 1.3, "65_plus" => 1.8, "25_34" => 0.7) if @f[:device_class] == :tablet
    bump(w, "under_18" => 2.2, "18_24" => 1.2, "35_49" => 0.6, "50_64" => 0.4, "65_plus" => 0.3) if @f[:os] == "ChromeOS"
    bump(w, "under_18" => 0.6, "65_plus" => 0.6) if @f[:adblock]
    Traits.normalize(w)
  end

  def gender
    w = { "masculine" => 0.5, "feminine" => 0.5 }
    bump(w, "masculine" => 1.5) if gamer?
    bump(w, "masculine" => 1.3) if developer?
    Traits.normalize(w)
  end

  def country_mix
    COUNTRY_ETHNICITY[@f[:country_code]]
  end

  def ethnicity
    keys = Traits::ETHNICITIES.keys
    mix = country_mix
    return Traits.uniform(keys) unless mix
    Traits.normalize(keys.to_h { |k| [ k, mix.fetch(k, 0.005) ] })
  end

  def archetype
    w = Traits::ARCHETYPES.keys.to_h { |k| [ k, 1.0 ] }
    bump(w, "gamer" => 5.0) if gamer?
    bump(w, "software_developer" => 5.0) if developer?
    bump(w, "designer_creative" => 3.5) if @f[:design_fonts]
    bump(w, "student" => 4.0) if @f[:network_type] == :university || @f[:os] == "ChromeOS"
    bump(w, "casual_phone_browser" => 6.0, "office_professional" => 0.3, "software_developer" => 0.4) if @f[:device_class] == :phone
    bump(w, "privacy_enthusiast" => 2.5) if @f[:adblock] && @f[:dnt]
    bump(w, "privacy_enthusiast" => 2.0) if @f[:browser] == "Firefox" || @f[:network_type] == :datacenter_or_vpn
    bump(w, "office_professional" => 2.5, "finance" => 1.5) if office_hours? && @f[:os] == "Windows" && !gamer?
    bump(w, "retiree" => 2.5) if @f[:device_class] == :tablet && !@f[:dark]
    Traits.normalize(w)
  end

  def archetype_gate
    Traits.top(archetype).last > 0.3 ? 0.75 : 0.4
  end

  def office_hours?
    @f[:hour] && @f[:hour].between?(9, 17) && !@f[:weekend]
  end

  def nouls
    {
      "plays_games" => gamer? ? 0.85 : (@f[:device_class] == :computer ? 0.4 : 0.45),
      "headphones" => @f[:gamepad] ? 0.72 : (gamer? && late? ? 0.6 : 0.35),
      "night_owl" => late? ? 0.8 : (@f[:hour] && @f[:hour].between?(6, 9) ? 0.2 : 0.45),
      "works_in_tech" => developer? ? 0.85 : 0.4,
      "work_device" => office_hours? && @f[:os] == "Windows" && !gamer? ? 0.6 : 0.35
    }
  end

  def affluence
    return 2.0 if @f[:gaming_gpu] || (@f[:apple_gpu] && @f[:device_class] == :computer) || @f[:hz].to_f > 100
    return 0.4 if @f[:os] == "ChromeOS" || @f[:cores].to_f.between?(1, 4)
    1.0
  end

  def tiredness
    return 1.0 unless @f[:hour]
    return 1.8 if @f[:hour].between?(1, 4)
    return 1.3 if @f[:hour] >= 23 || @f[:hour] == 0 || @f[:hour] == 5
    return 0.3 if @f[:hour].between?(9, 13)
    0.8
  end

  def bump(weights, factors)
    factors.each { |key, factor| weights[key] *= factor }
  end
end
