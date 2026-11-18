# Hunt settings.
#
# ME_DEV_PRIOR="lat,lon,radius_km" stands in for IP geolocation when the visitor's address cannot be
# placed (localhost, no IP database). Never used in production.
#
# Test flights (a synthetic plane the browser plays through its own speakers) are for checking the
# whole mic -> solver path with a known answer. Off in production unless ME_TEST_FLIGHTS=1, and the
# solver must also run with SOLVER_DEV=1.
Rails.application.configure do
  prior = ENV["ME_DEV_PRIOR"].to_s.split(",").map { Float(it, exception: false) }
  config.x.dev_prior = prior.size == 3 && prior.none?(&:nil?) && !Rails.env.production? ? prior : nil
  config.x.test_flights = !Rails.env.production? || ENV["ME_TEST_FLIGHTS"] == "1"
end
