# IP to coarse location, from DB-IP's free IP to City Lite database (CC BY 4.0, https://db-ip.com).
# `bin/rails geo:fetch` downloads it; the container does that on boot.
# Returns nil when the database is absent or the address has no location.
# latitude/longitude are the hunt's search prior and are never stored. DB-IP Lite gives no accuracy
# radius, so accuracy_radius is nil and the hunt falls back to its minimum search radius.
class GeoLookup
  Result = Data.define(:city, :country, :country_code, :latitude, :longitude, :accuracy_radius) do
    def located?
      !latitude.nil? && !longitude.nil?
    end
  end

  CITY_DB = ENV.fetch("GEOIP_CITY_DB", Rails.root.join("storage/geo/dbip-city-lite.mmdb").to_s)

  class << self
    attr_writer :instance

    def instance
      @instance ||= new
    end
  end

  # Reads from disk rather than memory: the file is ~130 MB and there is one lookup per hunt.
  def initialize(city_db: CITY_DB)
    @city = MaxMind::DB.new(city_db, mode: MaxMind::DB::MODE_FILE) if File.exist?(city_db)
  end

  # False when the database is missing: then nobody can be placed, whatever their address.
  def available?
    !@city.nil?
  end

  def call(ip)
    return nil if ip.blank? || @city.nil?
    city = @city.get(ip)
    return nil if city.nil?

    Result.new(
      city: city.dig("city", "names", "en"),
      country: city.dig("country", "names", "en"),
      country_code: city.dig("country", "iso_code"),
      latitude: city.dig("location", "latitude"),
      longitude: city.dig("location", "longitude"),
      accuracy_radius: city.dig("location", "accuracy_radius")
    )
  rescue IPAddr::InvalidAddressError, ArgumentError
    nil
  end
end
