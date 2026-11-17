# IP to coarse location and network type, from local MaxMind GeoLite2 files.
# Returns nil when the databases are absent or the address is private.
# latitude/longitude/accuracy_radius (km) are the hunt's search prior; they are never stored.
class GeoLookup
  Result = Data.define(:city, :country, :country_code, :network_type, :organization,
                       :latitude, :longitude, :accuracy_radius) do
    def located?
      !latitude.nil? && !longitude.nil?
    end
  end

  CITY_DB = ENV.fetch("GEOIP_CITY_DB", Rails.root.join("db/geo/GeoLite2-City.mmdb").to_s)
  ASN_DB = ENV.fetch("GEOIP_ASN_DB", Rails.root.join("db/geo/GeoLite2-ASN.mmdb").to_s)

  NETWORK_TYPES = {
    university: /universit|college|institute of|school|academ|\bedu\b/i,
    mobile_carrier: /mobile|wireless|cellular|telefonica moviles|vodafone|t-mobile|\bee\b/i,
    datacenter_or_vpn: /amazon|google cloud|microsoft azure|digitalocean|ovh|hetzner|linode|akamai|m247|datacamp|vpn|hosting|cloudflare/i
  }.freeze

  def self.instance
    @instance ||= new
  end

  def initialize(city_db: CITY_DB, asn_db: ASN_DB)
    @city = open_db(city_db)
    @asn = open_db(asn_db)
  end

  def call(ip)
    return nil if ip.blank? || (@city.nil? && @asn.nil?)
    city = @city&.get(ip)
    asn = @asn&.get(ip)
    return nil if city.nil? && asn.nil?

    organization = asn&.dig("autonomous_system_organization")
    Result.new(
      city: city&.dig("city", "names", "en"),
      country: city&.dig("country", "names", "en"),
      country_code: city&.dig("country", "iso_code"),
      network_type: classify(organization),
      organization: organization,
      latitude: city&.dig("location", "latitude"),
      longitude: city&.dig("location", "longitude"),
      accuracy_radius: city&.dig("location", "accuracy_radius")
    )
  rescue IPAddr::InvalidAddressError, ArgumentError
    nil
  end

  private

  def open_db(path)
    return nil unless File.exist?(path)
    MaxMind::DB.new(path, mode: MaxMind::DB::MODE_MEMORY)
  end

  def classify(organization)
    return nil if organization.blank?
    NETWORK_TYPES.each { |type, pattern| return type if organization.match?(pattern) }
    :home_or_office_broadband
  end
end
