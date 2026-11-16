# The one bundled question set sent to Jev per visitor, and the parser that
# turns its answers into the common trait shape. Jev judges; code decides.
module TraitQuestions
  SUBJECT = "The state describes a web browser session. Judge the person using the device."

  module_function

  def build
    questions = {
      "age_band" => choice("#{SUBJECT} Which age band are they most likely in?", Traits::AGE_BANDS),
      "gender" => choice("#{SUBJECT} How do they most likely present?", Traits::GENDERS),
      "gender_signal" => noul("The session contains a real indication of this person's gender."),
      "ethnicity" => choice("#{SUBJECT} What is their most likely ethnic background?", Traits::ETHNICITIES),
      "ethnicity_signal" => noul("The session contains a real indication of this person's ethnic background."),
      "archetype" => choice("#{SUBJECT} Which description fits them best?", Traits::ARCHETYPES),
      "archetype_none" => noul("None of these descriptions fits this person: #{Traits::ARCHETYPES.values.join('; ')}."),
      "affluence" => score("How expensive is the device being used?", [
        "Budget or old device", "Mid-range device", "Premium or high-end device"
      ]),
      "tiredness" => score("Given their local time and activity, how tired is this person likely to be?", [
        "Alert", "A little tired", "Exhausted"
      ])
    }
    Traits::NOULS.each { |key, statement| questions[key] = noul(statement) }
    questions
  end

  def parse(answers)
    {
      age_band: distribution(answers, "age_band", Traits::AGE_BANDS),
      gender: distribution(answers, "gender", Traits::GENDERS),
      ethnicity: distribution(answers, "ethnicity", Traits::ETHNICITIES),
      archetype: distribution(answers, "archetype", Traits::ARCHETYPES),
      gates: {
        gender: probability(answers, "gender_signal"),
        ethnicity: probability(answers, "ethnicity_signal"),
        archetype: 1.0 - probability(answers, "archetype_none")
      },
      nouls: Traits::NOULS.keys.to_h { |key| [ key, probability(answers, key) ] },
      scores: {
        affluence: Float(answers.fetch("affluence").fetch("score")),
        tiredness: Float(answers.fetch("tiredness").fetch("score"))
      }
    }
  rescue KeyError, TypeError, ArgumentError, NoMethodError => e
    raise JevClient::Error, "unexpected answer shape: #{e.message}"
  end

  def choice(instructions, options)
    { type: "choice", instructions: instructions, criteria: options }
  end

  def noul(instructions)
    { type: "noul", instructions: instructions }
  end

  def score(instructions, levels)
    { type: "score", instructions: instructions, criteria: levels }
  end

  def distribution(answers, key, options)
    given = answers.fetch(key).fetch("probabilities")
    Traits.normalize(options.keys.to_h { |option| [ option, Float(given.fetch(option, 0.0)) ] })
  end

  def probability(answers, key)
    Float(answers.fetch(key).fetch("noul")).clamp(0.0, 1.0)
  end
end
