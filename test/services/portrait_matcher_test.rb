require "test_helper"

class PortraitMatcherTest < ActiveSupport::TestCase
  setup do
    tags, grids = PlaceholderFaces.generate(60, seed: 7)
    @bank = PortraitBank.new(tags, grids.join)
    @matcher = PortraitMatcher.new(@bank)
  end

  def traits(age: "25_34", gender: "feminine", gender_gate: 0.9, headphones: 0.5)
    {
      age_band: PlaceholderFaces.near(Traits::AGE_BANDS.keys, age, 0.8),
      gender: PlaceholderFaces.near(Traits::GENDERS.keys, gender, 0.9),
      ethnicity: Traits.uniform(Traits::ETHNICITIES.keys),
      archetype: Traits.uniform(Traits::ARCHETYPES.keys),
      gates: { gender: gender_gate, ethnicity: 0.1, archetype: 0.5 },
      nouls: Traits::NOULS.keys.to_h { |k| [ k, 0.5 ] }.merge("headphones" => headphones),
      scores: { affluence: 1.0, tiredness: 1.0 }
    }
  end

  test "bank grids have one byte per cell" do
    assert_equal PortraitBank::CELLS, @bank.grid(0).bytesize
    assert_equal PortraitBank::CELLS, @bank.grid(@bank.size - 1).bytesize
  end

  test "matches the confident traits" do
    match = @matcher.call(traits(age: "65_plus", gender: "masculine"), seed: 1)
    tags = @bank.tags[match.index]

    assert_equal "65_plus", Traits.top(tags["age_band"]).first
    assert_equal "masculine", Traits.top(tags["gender"]).first
  end

  test "a determined headphones guess pulls in headphones" do
    vague = traits(headphones: 0.95, gender_gate: 0.0).merge(age_band: Traits.uniform(Traits::AGE_BANDS.keys))
    match = @matcher.call(vague, seed: 1)

    assert_operator @bank.tags[match.index]["headphones"], :>, 0.5
  end

  test "same seed gives the same portrait" do
    first = @matcher.call(traits, seed: 42)
    again = @matcher.call(traits, seed: 42)

    assert_equal first.index, again.index
  end

  test "keeps the current portrait unless the new one is clearly better" do
    current = @matcher.call(traits, seed: 3).index
    nudged = traits(gender_gate: 0.85)

    assert_equal current, @matcher.call(nudged, seed: 99, current: current).index

    changed = @matcher.call(traits(age: "under_18", gender: "masculine"), seed: 99, current: current).index
    assert_not_equal current, changed
  end

  test "ignores an out-of-range current portrait" do
    assert_nothing_raised { @matcher.call(traits, seed: 1, current: 10_000) }
  end
end
