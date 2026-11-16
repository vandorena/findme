# Picks the portrait whose tags sit closest to the visitor's guessed traits.
# Each trait's pull is scaled by how sure we are of it, so vague guesses leave
# the choice to the seeded shuffle rather than forcing a stereotype.
class PortraitMatcher
  Match = Data.define(:index, :distance)

  TOP_K = 5
  # A new portrait must beat the one on screen by this much to replace it.
  SWITCH_MARGIN = 0.06

  def initialize(bank)
    @bank = bank
  end

  def call(traits, seed:, current: nil)
    match_with(Target.new(traits), seed: seed, current: current)
  end

  # Match against features read directly from a real photo: every observed
  # trait pulls at full weight, since we are looking at an actual face.
  def call_observed(tags, seed:, current: nil)
    match_with(ObservedTarget.new(tags), seed: seed, current: current)
  end

  private

  def match_with(target, seed:, current:)
    distances = @bank.tags.map { |tags| target.distance(tags) }
    ranked = distances.each_index.sort_by { |i| distances[i] }.first(TOP_K)
    best = ranked.first

    if current && current.between?(0, @bank.size - 1) && distances[current] <= distances[best] + SWITCH_MARGIN
      return Match.new(index: current, distance: distances[current])
    end

    pick = ranked.sample(random: Random.new(seed))
    Match.new(index: pick, distance: distances[pick])
  end

  public

  # Total variation distance between two distributions over the same keys.
  def self.variation(a, b)
    a.sum { |key, p| (p - b.fetch(key, 0.0)).abs } / 2.0
  end

  # Features read straight from a photo: no gates, everything observed.
  class ObservedTarget
    def initialize(tags)
      @tags = tags
    end

    def distance(bank)
      total = 0.0
      total += PortraitMatcher.variation(@tags["age_band"], bank["age_band"])
      total += PortraitMatcher.variation(@tags["gender"], bank["gender"])
      total += 0.8 * PortraitMatcher.variation(@tags["ethnicity"], bank["ethnicity"])
      total += 0.5 * PortraitMatcher.variation(@tags["expression"], bank["expression"])
      %w[glasses facial_hair headphones].each do |feature|
        total += 0.5 * (@tags[feature] - bank[feature]).abs
      end
      total
    end
  end

  # The visitor's traits, reduced to weights once per request.
  class Target
    def initialize(traits)
      @traits = traits
      gates = traits[:gates]
      @weights = {
        "age_band" => Traits.sharpness(traits[:age_band]),
        "gender" => Traits.sharpness(traits[:gender]) * gates[:gender],
        "ethnicity" => Traits.sharpness(traits[:ethnicity]) * gates[:ethnicity]
      }
      nouls = traits[:nouls]
      @headphones = nouls["headphones"] if Traits.determined?(nouls["headphones"])
      @glasses = 0.7 if nouls["works_in_tech"] > Traits::UNDETERMINED.end
      @tired = (traits[:scores][:tiredness] / 2.0).clamp(0.0, 1.0)
    end

    def distance(tags)
      total = 0.0
      total += @weights["age_band"] * variation(@traits[:age_band], tags["age_band"])
      total += @weights["gender"] * variation(@traits[:gender], tags["gender"])
      total += @weights["ethnicity"] * variation(@traits[:ethnicity], tags["ethnicity"])
      total += 0.4 * (@headphones - tags["headphones"]).abs if @headphones
      total += 0.12 * (@glasses - tags["glasses"]).abs if @glasses
      total += 0.25 * (@tired - tags["expression"]["tired"]).abs
      total
    end

    private

    def variation(a, b)
      PortraitMatcher.variation(a, b)
    end
  end
end
