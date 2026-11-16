# Procedurally drawn stand-in portraits so the whole pipeline runs before the
# real face bank exists. Produces the same outputs as the real bank build:
# a brightness grid per portrait (1 byte per cell) and Jev-style tag
# probabilities.
module PlaceholderFaces
  WIDTH = 96
  HEIGHT = 48

  SKIN = {
    "white" => 215, "east_asian" => 205, "latino" => 185, "middle_eastern" => 180,
    "southeast_asian" => 172, "south_asian" => 158, "black" => 118
  }.freeze
  EXPRESSIONS = %w[tired neutral smiling].freeze

  module_function

  # Returns [tags, grids]: an array of tag hashes and an array of binary strings.
  def generate(count, seed: 1)
    rng = Random.new(seed)
    faces = Array.new(count) { |id| sample(id, rng) }
    [ faces.map { |face| tags(face) }, faces.map { |face| draw(face, rng) } ]
  end

  def sample(id, rng)
    age = rng.rand(Traits::AGE_BANDS.size)
    gender = Traits::GENDERS.keys.sample(random: rng)
    masculine = gender == "masculine"
    {
      id: id,
      age: age,
      gender: gender,
      ethnicity: Traits::ETHNICITIES.keys.sample(random: rng),
      glasses: rng.rand < (age >= 3 ? 0.5 : 0.3),
      facial_hair: masculine && age >= 1 && rng.rand < 0.4,
      headphones: rng.rand < (age <= 2 ? 0.3 : 0.08),
      expression: EXPRESSIONS.sample(random: rng),
      bald: masculine && age >= 3 && rng.rand < 0.25,
      long_hair: masculine ? rng.rand < 0.12 : rng.rand < 0.75,
      grey: age >= 4 || (age == 3 && rng.rand < 0.3),
      head_width: 0.4 + rng.rand * 0.06
    }
  end

  def tags(face)
    {
      "id" => face[:id],
      "age_band" => near(Traits::AGE_BANDS.keys, Traits::AGE_BANDS.keys[face[:age]], 0.8),
      "gender" => near(Traits::GENDERS.keys, face[:gender], 0.92),
      "ethnicity" => near(Traits::ETHNICITIES.keys, face[:ethnicity], 0.8),
      "expression" => near(EXPRESSIONS, face[:expression], 0.85),
      "glasses" => face[:glasses] ? 0.95 : 0.03,
      "facial_hair" => face[:facial_hair] ? 0.93 : 0.04,
      "headphones" => face[:headphones] ? 0.95 : 0.02
    }
  end

  def near(keys, label, mass)
    rest = (1.0 - mass) / (keys.size - 1)
    keys.to_h { |key| [ key, key == label ? mass : rest ] }
  end

  def draw(face, rng)
    bytes = Array.new(WIDTH * HEIGHT)
    HEIGHT.times do |row|
      y = (row + 0.5) / HEIGHT * 2 - 1
      WIDTH.times do |col|
        x = (col + 0.5) / WIDTH * 2 - 1
        value = pixel(face, x, y) + rng.rand(-7..7)
        bytes[row * WIDTH + col] = value.round.clamp(0, 255)
      end
    end
    bytes.pack("C*")
  end

  # Brightness 0..255 at a point in a [-1, 1] square, later layers on top.
  def pixel(face, x, y)
    skin = SKIN.fetch(face[:ethnicity])
    rx = face[:head_width]
    ry = face[:age].zero? ? 0.5 : 0.56
    cy = -0.05
    ax = x.abs
    head = (x / rx)**2 + ((y - cy) / ry)**2
    hair_tone = face[:grey] ? 190 : 38
    eye_y = -0.1
    tired = face[:expression] == "tired"

    value = 14 + 10 * (1 - (x * x + y * y) / 2)

    # shoulders and neck
    value = 96 if (x / 0.85)**2 + ((y - 1.2) / 0.52)**2 < 1
    value = skin * 0.72 if ax < 0.15 && y.between?(0.4, 0.78)

    # long hair falls behind the face
    if face[:long_hair] && !face[:bald] && y.between?(-0.45, 0.6) && (x / (rx + 0.13))**2 + ((y - cy) / (ry + 0.3))**2 < 1
      value = hair_tone
    end

    if head < 1
      value = skin * (1 - 0.3 * head) - x * 14
      value -= 45 if face[:facial_hair] && y > 0.14 + 0.5 * ax * ax && head > 0.25
      value = skin - 35 if ax < 0.025 && y.between?(-0.02, 0.14)                # nose
      value -= 22 if face[:age] >= 4 && ax < 0.24 && [ -0.3, -0.36 ].any? { |line| (y - line).abs < 0.012 }
      value -= 28 if tired && ((ax - 0.17) / 0.09)**2 + ((y - eye_y - 0.075) / 0.03)**2 < 1

      eye_h = tired ? 0.022 : (face[:age].zero? ? 0.045 : 0.034)
      value = 22 if ((ax - 0.17) / 0.07)**2 + ((y - eye_y) / eye_h)**2 < 1
      value = hair_tone * 0.8 if (ax - 0.17).abs < 0.09 && (y - eye_y + 0.1).abs < 0.014 # brows

      curve = { "smiling" => -1.6, "neutral" => 0.0, "tired" => 0.7 }.fetch(face[:expression])
      value = 40 if ax < 0.15 && (y - (0.29 + curve * (ax * ax - 0.0225))).abs < 0.016
    end

    # hair on top of the head
    unless face[:bald]
      cap = (x / (rx + 0.05))**2 + ((y - cy) / (ry + 0.07))**2
      hairline = -0.36 + 0.5 * x * x
      value = hair_tone + 25 * (y + 0.6) if cap < 1 && y < hairline
    end

    if face[:glasses]
      ring = Math.sqrt((ax - 0.17)**2 + ((y - eye_y) * 1.1)**2)
      value = 12 if (ring - 0.11).abs < 0.014 || (ax < 0.06 && (y - eye_y).abs < 0.012)
    end

    if face[:headphones]
      band = Math.sqrt(x * x + (y + 0.02)**2)
      value = 228 if band.between?(0.62, 0.69) && y < -0.05
      value = 242 if ax.between?(rx - 0.02, rx + 0.14) && y.between?(-0.2, 0.16)
    end

    value
  end
end
