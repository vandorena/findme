require "net/http"

# Minimal client for TypeSafe's System One endpoint. One keep-alive connection
# per thread so the hot path skips the TLS handshake; no retries, because the
# caller has a latency budget and a fallback.
class JevClient
  class Error < StandardError; end

  ENDPOINT = URI("https://api.typesafe.ai/v1/systemone")

  def self.from_env
    key = ENV["TYPESAFE_API_KEY"]
    key.present? ? new(key) : nil
  end

  def initialize(api_key, model: ENV.fetch("TYPESAFE_MODEL", "jev-latest"), timeout: 2.0)
    @api_key = api_key
    @model = model
    @timeout = timeout
  end

  # Returns the "answers" hash keyed by question name.
  def ask(state:, questions:)
    request = Net::HTTP::Post.new(ENDPOINT.path)
    request["Content-Type"] = "application/json"
    request.body = JSON.generate(model: @model, state: state, questions: questions)
    send(request)
  end

  # Asks image questions about a single face. The image rides in a multipart
  # body alongside the JSON request; the asset placeholder appears in the state
  # so the questions refer to it.
  # NOTE: verify the exact asset/placeholder shape against
  # https://docs.typesafe.ai/images.md before the first live call.
  def ask_about_image(image:, content_type:, questions:, asset: "face")
    boundary = "jev#{SecureRandom.hex(12)}"
    # The reference string `asset` is the state value; questions refer to it as
    # `photo` in backticks. See https://docs.typesafe.ai/images.md.
    payload = {
      model: @model,
      state: { "photo" => asset },
      assets: { asset => { "type" => "image", "part" => asset } },
      questions: questions
    }
    request = Net::HTTP::Post.new(ENDPOINT.path)
    request["Content-Type"] = "multipart/form-data; boundary=#{boundary}"
    request["TypeSafe-Danger-Zone-Images"] = "true"
    request.body = multipart(boundary, JSON.generate(payload), asset, image, content_type)
    send(request)
  end

  private

  def send(request)
    request["Authorization"] = "Bearer #{@api_key}"
    response = connection.request(request)
    raise Error, "HTTP #{response.code}: #{response.body.to_s[0, 200]}" unless response.is_a?(Net::HTTPSuccess)
    JSON.parse(response.body).fetch("answers")
  rescue Timeout::Error, SocketError, SystemCallError, OpenSSL::SSL::SSLError, EOFError, IOError,
         JSON::ParserError, KeyError => e
    reset
    raise Error, "#{e.class}: #{e.message}"
  end

  def multipart(boundary, json, asset, image, content_type)
    body = "".b
    body << "--#{boundary}\r\n"
    body << "Content-Disposition: form-data; name=\"request\"\r\n"
    body << "Content-Type: application/json\r\n\r\n"
    body << json.b << "\r\n"
    body << "--#{boundary}\r\n"
    body << "Content-Disposition: form-data; name=\"#{asset}\"; filename=\"#{asset}\"\r\n"
    body << "Content-Type: #{content_type}\r\n\r\n"
    body << image.b << "\r\n"
    body << "--#{boundary}--\r\n"
    body
  end

  private

  def connection
    Thread.current[:jev_http] ||= Net::HTTP.new(ENDPOINT.host, ENDPOINT.port).tap do |http|
      http.use_ssl = true
      http.open_timeout = @timeout / 2
      http.read_timeout = @timeout
      http.write_timeout = @timeout / 2
      http.keep_alive_timeout = 20
      http.max_retries = 0
      http.start
    end
  end

  def reset
    Thread.current[:jev_http]&.finish
  rescue IOError
    nil
  ensure
    Thread.current[:jev_http] = nil
  end
end
