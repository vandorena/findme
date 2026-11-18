require "test_helper"

class GeoDatabaseTest < ActiveSupport::TestCase
  setup do
    @dir = Dir.mktmpdir
    @path = File.join(@dir, "city.mmdb")
  end

  teardown { FileUtils.rm_rf(@dir) }

  test "tries this month's file, then last month's" do
    db = GeoDatabase.new(path: @path, now: Time.utc(2026, 1, 3))

    assert_equal %w[https://download.db-ip.com/free/dbip-city-lite-2026-01.mmdb.gz
                    https://download.db-ip.com/free/dbip-city-lite-2025-12.mmdb.gz], db.urls
  end

  test "a copy under a month old is left alone" do
    File.write(@path, "old")

    assert GeoDatabase.new(path: @path).fresh?
    assert_not GeoDatabase.new(path: @path, now: 40.days.from_now.utc).fresh?
    assert_not GeoDatabase.new(path: File.join(@dir, "absent.mmdb")).fresh?
  end

  test "a corrupt download never replaces the working file" do
    File.write(@path, "old")
    db = GeoDatabase.new(path: @path, now: 40.days.from_now.utc)
    db.define_singleton_method(:download) { |_url, part| File.write(part, "not a database") }

    assert_raises(MaxMind::DB::InvalidDatabaseError) { db.fetch }
    assert_equal "old", File.read(@path)
    assert_equal [ "city.mmdb" ], Dir.children(@dir)
  end
end
