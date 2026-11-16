# Shapes the guessed traits into what the page shows next to the portrait.
class Evidence
  def initialize(traits)
    @traits = traits
  end

  def guesses
    gates = @traits[:gates]
    rows = [
      choice("age", :age_band, Traits::AGE_BANDS),
      choice("presents as", :gender, Traits::GENDERS, gate: gates[:gender]),
      choice("background", :ethnicity, Traits::ETHNICITIES, gate: gates[:ethnicity]),
      choice("type", :archetype, Traits::ARCHETYPES, gate: gates[:archetype])
    ]
    @traits[:nouls].each do |key, p|
      rows << { trait: key.tr("_", " "), label: p >= 0.5 ? "yes" : "no", p: [ p, 1 - p ].max.round(3), unsure: !Traits.determined?(p) }
    end
    rows
  end

  # 0..1, how much the portrait should be trusted; drives the visual noise.
  def confidence
    gates = @traits[:gates]
    parts = [
      Traits.sharpness(@traits[:age_band]),
      Traits.sharpness(@traits[:gender]) * gates[:gender],
      Traits.sharpness(@traits[:ethnicity]) * gates[:ethnicity]
    ]
    (parts.sum / parts.size).round(3)
  end

  private

  def choice(name, key, labels, gate: 1.0)
    option, p = Traits.top(@traits[key])
    { trait: name, label: labels.fetch(option), p: p.round(3), unsure: gate < 0.5 || p < 1.5 / labels.size }
  end
end
