# Keeps DB-IP's free IP to City Lite database on disk. DB-IP publishes it monthly at a dated URL with no
# account or key; the licence (CC BY 4.0) asks for the "IP Geolocation by DB-IP" credit in the footer.
require "net/http"
require "zlib"

class GeoDatabase
  URL = "https://download.db-ip.com/free/dbip-city-lite-%Y-%m.mmdb.gz".freeze
  MAX_AGE = 32.days

  def initialize(path: GeoLookup::CITY_DB, now: Time.now.utc)
    @path = path
    @now = now
  end

  def fresh?
    File.exist?(@path) && File.mtime(@path) > @now - MAX_AGE
  end

  # This month's file, then last month's: early in a month the new one may not be out yet.
  def urls
    [ @now, @now.prev_month ].map { it.strftime(URL) }
  end

  # Downloads and swaps in a new file unless the current one is fresh. Returns the URL used, or nil.
  def fetch(force: false)
    return nil if fresh? && !force

    FileUtils.mkdir_p(File.dirname(@path))
    part = "#{@path}.part"
    urls.each do |url|
      next unless download(url, part)
      MaxMind::DB.new(part, mode: MaxMind::DB::MODE_FILE).close # refuses a truncated or corrupt file
      File.rename(part, @path)
      return url
    end
    raise "no DB-IP City Lite file at #{urls.join(' or ')}"
  ensure
    FileUtils.rm_f(part) if part
  end

  private

  def download(url, part)
    uri = URI(url)
    gz = "#{part}.gz"
    Net::HTTP.start(uri.host, uri.port, use_ssl: true, open_timeout: 10, read_timeout: 60) do |http|
      http.request_get(uri.request_uri) do |response|
        return false if response.is_a?(Net::HTTPNotFound)
        response.value
        File.open(gz, "wb") { |out| response.read_body { out.write(it) } }
      end
    end
    Zlib::GzipReader.open(gz) { |unzipped| File.open(part, "wb") { IO.copy_stream(unzipped, it) } }
    true
  ensure
    FileUtils.rm_f(gz) if gz
  end
end
