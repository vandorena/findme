require "test_helper"

class TraitInferenceTest < ActiveSupport::TestCase
  class StubClient
    attr_reader :request

    def initialize(answers = nil, &failure)
      @answers = answers
      @failure = failure
    end

    def ask(state:, questions:)
      @request = { state: state, questions: questions }
      @failure&.call
      @answers
    end
  end

  def jev_answers
    spread = ->(keys) { { "probabilities" => keys.each_with_index.to_h { |k, i| [ k, i.zero? ? 0.7 : 0.3 / (keys.size - 1) ] } } }
    answers = {
      "age_band" => spread.(Traits::AGE_BANDS.keys),
      "gender" => spread.(Traits::GENDERS.keys),
      "ethnicity" => spread.(Traits::ETHNICITIES.keys),
      "archetype" => spread.(Traits::ARCHETYPES.keys),
      "gender_signal" => { "noul" => 0.2 }, "ethnicity_signal" => { "noul" => 0.1 }, "archetype_none" => { "noul" => 0.25 },
      "affluence" => { "score" => 1.7 }, "tiredness" => { "score" => 0.4 }
    }
    Traits::NOULS.each_key { |key| answers[key] = { "noul" => 0.9 } }
    answers
  end

  test "questions follow the System One schema" do
    questions = TraitQuestions.build

    questions.each_value do |question|
      assert_includes %w[choice noul score], question[:type]
      assert question[:instructions].present?
    end
    assert_equal Traits::AGE_BANDS.keys, questions["age_band"][:criteria].keys
    assert_kind_of Array, questions["tiredness"][:criteria]
    assert_operator questions["archetype"][:criteria].size, :<=, 255
  end

  test "uses Jev answers when the client succeeds" do
    client = StubClient.new(jev_answers)
    result = TraitInference.new(client: client).call(profile_for(GAMING_PC))

    assert_equal "jev", result.source
    assert_in_delta 0.7, result.traits[:age_band]["under_18"]
    assert_in_delta 0.75, result.traits[:gates][:archetype]
    assert_in_delta 1.7, result.traits[:scores][:affluence]
    assert_equal profile_for(GAMING_PC).state, client.request[:state]
  end

  test "falls back to heuristics when Jev fails" do
    client = StubClient.new { raise JevClient::Error, "timeout" }
    result = TraitInference.new(client: client).call(profile_for(GAMING_PC))

    assert_equal "heuristic", result.source
  end

  test "falls back when the answer shape is wrong" do
    result = TraitInference.new(client: StubClient.new({ "age_band" => {} })).call(profile_for(IPHONE))

    assert_equal "heuristic", result.source
  end

  test "heuristics read a late-night gaming PC as a young gamer" do
    traits = TraitInference.new(client: nil).call(profile_for(GAMING_PC)).traits

    assert_equal "gamer", Traits.top(traits[:archetype]).first
    assert_operator traits[:age_band]["18_24"], :>, traits[:age_band]["50_64"]
    assert_operator traits[:nouls]["plays_games"], :>, 0.7
    assert_operator traits[:scores][:tiredness], :>, 1.5
    traits.slice(:age_band, :gender, :ethnicity, :archetype).each_value do |distribution|
      assert_in_delta 1.0, distribution.values.sum
    end
  end

  test "heuristics stay near the prior without evidence" do
    traits = HeuristicTraits.new({}).call

    assert_in_delta 0.5, traits[:gender]["masculine"]
    assert_operator traits[:gates][:ethnicity], :<, 0.3
  end
end
