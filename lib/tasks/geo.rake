namespace :geo do
  desc "Download DB-IP City Lite for the IP prior, unless the copy on disk is under a month old (FORCE=1 to redo)"
  task fetch: :environment do
    url = GeoDatabase.new.fetch(force: ENV["FORCE"] == "1")
    puts url ? "geo: fetched #{url}" : "geo: #{GeoLookup::CITY_DB} is up to date"
  end
end
