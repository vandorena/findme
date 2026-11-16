require "test_helper"

class SelfPortraitFlowTest < ActionDispatch::IntegrationTest
  # A tiny valid PNG, decoded in memory per test.
  PNG = Base64.decode64(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
  )

  def upload
    Rack::Test::UploadedFile.new(StringIO.new(PNG), "image/png", original_filename: "me.png")
  end

  def sign_in(name = "Alex")
    post session_path, params: { name: name }
  end

  test "signed-out visitor sees the sign-in prompt" do
    get self_portrait_path

    assert_response :success
    assert_select "form.signin"
    assert_select "[data-controller=twin]", false
  end

  test "the twin endpoint refuses an unauthenticated request" do
    post self_portrait_path, params: { photo: upload }, headers: { "Accept" => "application/json" }
    assert_response :unauthorized

    post self_portrait_path, params: { photo: upload } # html falls back to the sign-in page
    assert_redirected_to self_portrait_path
  end

  test "a signed-in visitor gets a twin from their photo" do
    sign_in
    follow_redirect!
    assert_select "[data-controller=twin]"

    post self_portrait_path, params: { photo: upload }, headers: { "Accept" => "application/json" }

    assert_response :success
    body = response.parsed_body
    assert_equal PortraitBank::CELLS, Base64.decode64(body["portrait"]["grid"]).bytesize
    assert_equal "placeholder", body["source"]
    assert body["guesses"].any? { |guess| guess["trait"] == "age" }
  end

  test "it rejects a non-image upload" do
    sign_in
    post self_portrait_path, params: { photo: Rack::Test::UploadedFile.new(StringIO.new("not an image"), "text/plain", original_filename: "x.txt") }, headers: { "Accept" => "application/json" }

    assert_response :unprocessable_entity
  end

  test "the uploaded photo bytes are not persisted anywhere" do
    sign_in

    post self_portrait_path, params: { photo: upload }, headers: { "Accept" => "application/json" }

    assert_response :success
    # No file under the app holds the uploaded bytes, and no image landed in storage.
    leaked = Dir.glob(Rails.root.join("{tmp,storage,log}/**/*")).select do |path|
      File.file?(path) && File.binread(path).include?(PNG)
    end
    assert_empty leaked, "upload bytes were written to #{leaked.join(', ')}"
    assert_empty Dir.glob(Rails.root.join("storage/**/*.{png,jpg,jpeg}"))
  end

  test "sign out clears the session" do
    sign_in
    delete session_path
    follow_redirect!

    assert_select "form.signin"
  end
end
