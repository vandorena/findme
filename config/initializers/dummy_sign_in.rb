# The self-portrait sign-in is a development placeholder standing in for a real
# OAuth provider. It verifies nothing, so it must never be reachable in
# production. Set ME_DUMMY_SIGN_IN=true to force it on elsewhere.
Rails.application.configure do
  config.x.dummy_sign_in = ENV["ME_DUMMY_SIGN_IN"] == "true" || !Rails.env.production?
end
