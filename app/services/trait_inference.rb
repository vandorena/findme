# Asks Jev for the visitor's traits, falling back to rules when there is no
# key or the call fails or times out.
class TraitInference
  Result = Data.define(:traits, :source)

  def initialize(client: JevClient.from_env)
    @client = client
  end

  def call(profile)
    return heuristic(profile) unless @client
    answers = @client.ask(state: profile.state, questions: TraitQuestions.build)
    Result.new(traits: TraitQuestions.parse(answers), source: "jev")
  rescue JevClient::Error => e
    Rails.logger.warn("Jev unavailable, using heuristics: #{e.message}")
    heuristic(profile)
  end

  private

  def heuristic(profile)
    Result.new(traits: HeuristicTraits.new(profile.facts).call, source: "heuristic")
  end
end
