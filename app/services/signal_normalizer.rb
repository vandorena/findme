# Turns the raw browser payload into:
#   state: named, human-readable fields sent to Jev and shown in the evidence panel
#   facts: structured values for the rule-based fallback
# Everything from the client is untrusted, so every value is coerced and capped.
class SignalNormalizer
  Profile = Data.define(:state, :facts)

  WEEKDAYS = %w[Sunday Monday Tuesday Wednesday Thursday Friday Saturday].freeze
  GAMING_GPU = /RTX|GTX|Radeon RX|Arc\(TM\) A\d|Arc A\d/i
  DEV_FONTS = [ "Fira Code", "JetBrains Mono", "Cascadia Code", "Source Code Pro", "Hack" ].freeze
  DESIGN_FONTS = [ "Helvetica Neue", "Futura", "Avenir", "Proxima Nova", "Gotham", "Inter" ].freeze

  def initialize(signals:, behavior: nil, geo: nil, headers: {})
    @s = signals.is_a?(Hash) ? signals : {}
    @b = behavior.is_a?(Hash) ? behavior : {}
    @geo = geo
    @headers = headers
    @state = {}
    @facts = {}
  end

  def call
    device
    hardware
    display
    preferences
    clock
    network
    behavior
    Profile.new(state: @state, facts: @facts)
  end

  private

  def device
    ua = str(@s["ua"], 300).to_s
    hints = dict(@s["uaData"])
    os = str(hints["platform"]).presence || os_from(ua)
    os_version = str(hints["platformVersion"], 20)
    browser = browser_from(ua)
    touch = num(@s["touchPoints"]).to_i
    mobile = hints["mobile"] == true || ua.match?(/Mobi|iPhone/)
    tablet = ua.match?(/iPad/) || (ua.match?(/Android/) && !mobile) || (os == "macOS" && touch > 1)

    @facts[:os] = os
    @facts[:browser] = browser
    @facts[:touch] = touch.positive?
    @facts[:device_class] = tablet ? :tablet : (mobile ? :phone : :computer)

    kind = { phone: "phone", tablet: "tablet", computer: "laptop or desktop computer" }[@facts[:device_class]]
    model = str(hints["model"], 40)
    @state[:device] = [ model.presence, kind, [ os, os_version ].compact_blank.join(" ").presence, browser ].compact.join(", ")
    @state[:input] = touch.positive? ? "touchscreen (#{touch} touch points)" : "mouse or trackpad, no touchscreen"

    pads = Array(@s["gamepads"]).first(4).filter_map { |g| str(g, 60) }
    @facts[:gamepad] = pads.any? || @b["gamepadActive"] == true
    @state[:game_controller] = pads.join("; ") if pads.any?
  end

  def hardware
    gpu = str(@s["gpu"], 120)
    cores = num(@s["cores"])
    memory = num(@s["memory"])
    @facts[:gaming_gpu] = gpu.to_s.match?(GAMING_GPU)
    @facts[:apple_gpu] = gpu.to_s.match?(/Apple/i)
    @facts[:cores] = cores
    @facts[:memory] = memory
    @state[:graphics] = gpu if gpu
    parts = []
    parts << "#{cores.to_i} CPU cores" if cores
    parts << "#{memory.to_i >= 8 ? '8+' : memory.to_i} GB memory reported" if memory
    @state[:hardware] = parts.join(", ") if parts.any?

    battery = dict(@s["battery"])
    if (level = num(battery["level"]))
      @facts[:battery] = level
      @state[:battery] = "#{(level * 100).round}%, #{battery['charging'] == true ? 'charging' : 'on battery'}"
    end
  end

  def display
    screen = dict(@s["screen"])
    window = dict(@s["window"])
    w, h, dpr = num(screen["w"]), num(screen["h"]), num(screen["dpr"])
    hz = num(@s["hz"])
    @facts[:hz] = hz
    @facts[:screen_width] = w
    if w && h
      text = "#{w.to_i}x#{h.to_i}"
      text += " at #{dpr.round(2)}x pixel density" if dpr
      text += ", about #{hz.round} Hz refresh" if hz
      @state[:display] = text
    end
    ww = num(window["w"])
    if w && ww && w.positive?
      share = ww / w
      @facts[:window_share] = share
      @state[:browser_window] = share > 0.9 ? "full width of the screen" : "takes up #{(share * 100).round}% of the screen width"
    end
  end

  def preferences
    @facts[:dark] = @s["darkMode"] == true
    @state[:appearance] = [ @facts[:dark] ? "dark mode" : "light mode", (@s["reducedMotion"] == true ? "reduced motion on" : nil) ].compact.join(", ")

    languages = Array(@s["languages"]).first(6).filter_map { |l| str(l, 12) }
    languages = [ str(@headers["Accept-Language"], 60) ].compact if languages.empty?
    @facts[:languages] = languages
    @state[:languages] = languages.join(", ") if languages.any?

    fonts = Array(@s["fonts"]).first(30).filter_map { |f| str(f, 40) }
    @facts[:dev_fonts] = (fonts & DEV_FONTS).any?
    @facts[:design_fonts] = (fonts & DESIGN_FONTS).size >= 2
    @state[:notable_fonts_installed] = fonts.join(", ") if fonts.any?

    @facts[:adblock] = @s["adblock"] == true
    @facts[:dnt] = @s["dnt"] == true
    privacy = []
    privacy << "ad blocker active" if @facts[:adblock]
    privacy << "Do Not Track enabled" if @facts[:dnt]
    @state[:privacy] = privacy.join(", ") if privacy.any?

    referrer = str(@s["referrer"], 80)
    @state[:arrived_from] = referrer if referrer.present?
  end

  def clock
    local = dict(@s["localTime"])
    hour, minute, weekday = num(local["hour"]), num(local["minute"]), num(local["weekday"])
    if hour && hour.between?(0, 23)
      @facts[:hour] = hour.to_i
      @facts[:weekend] = [ 0, 6 ].include?(weekday.to_i)
      day = WEEKDAYS[weekday.to_i.clamp(0, 6)]
      @state[:local_time] = format("%02d:%02d on %s", hour, minute.to_i.clamp(0, 59), day)
    end
    timezone = str(@s["timezone"], 40)
    @state[:timezone] = timezone if timezone
  end

  def network
    if @geo
      @facts[:country_code] = @geo.country_code
      @facts[:network_type] = @geo.network_type
      place = [ @geo.city, @geo.country ].compact.join(", ")
      @state[:location] = place if place.present?
      if @geo.network_type
        @state[:network] = "#{@geo.network_type.to_s.tr('_', ' ')} (#{@geo.organization})"
      end
    end
    connection = dict(@s["connection"])
    type = str(connection["type"], 12)
    downlink = num(connection["downlink"])
    @state[:connection] = [ type, (downlink ? "#{downlink} Mbps" : nil) ].compact.join(", ") if type || downlink
  end

  def behavior
    return if @b.empty?
    pointer = dict(@b["pointer"])
    speed = num(pointer["avgSpeed"])
    if speed && num(pointer["samples"]).to_i > 20
      turn = num(pointer["turniness"]).to_f
      @facts[:pointer_speed] = speed
      pace = speed > 1500 ? "fast" : (speed > 500 ? "moderate" : "slow")
      style = turn > 0.6 ? "erratic" : "smooth and direct"
      @state[:pointer_movement] = "#{pace}, #{style} (about #{speed.round} px/s)"
    end

    scroll = dict(@b["scroll"])
    kind = { "wheel" => "a notched mouse wheel", "trackpad" => "a trackpad", "touch" => "touch swipes" }[scroll["kind"]]
    @facts[:scroll_kind] = scroll["kind"] if kind
    @state[:scrolling] = "with #{kind}" if kind

    typing = dict(@b["typing"])
    keys = num(typing["keys"]).to_i
    if keys >= 5 && (interval = num(typing["meanIntervalMs"]))
      @facts[:typing_interval] = interval
      @state[:typing] = "#{keys} keys, about #{interval.round} ms between keys, #{num(typing['backspaces']).to_i} corrections"
    end

    blurs = num(@b["blurs"]).to_i
    @state[:attention] = "switched away from this tab #{blurs} times" if blurs.positive?
    @state[:game_controller_use] = "pressing buttons on a game controller" if @b["gamepadActive"] == true
  end

  def os_from(ua)
    case ua
    when /Windows NT/ then "Windows"
    when /iPhone/ then "iOS"
    when /iPad/ then "iPadOS"
    when /Android/ then "Android"
    when /CrOS/ then "ChromeOS"
    when /Mac OS X/ then "macOS"
    when /Linux/ then "Linux"
    end
  end

  def browser_from(ua)
    case ua
    when /Edg\// then "Edge"
    when /OPR\// then "Opera"
    when /Firefox\// then "Firefox"
    when /Chrome\// then "Chrome"
    when /Safari\// then "Safari"
    end
  end

  def dict(value)
    value.is_a?(Hash) ? value : {}
  end

  def str(value, max = 60)
    return nil unless value.is_a?(String)
    value.gsub(/[[:cntrl:]]/, " ").strip[0, max].presence
  end

  def num(value)
    return nil unless value.is_a?(Numeric) && value.finite?
    value.to_f
  end
end
