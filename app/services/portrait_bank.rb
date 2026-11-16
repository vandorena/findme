# The in-memory portrait bank: tag probabilities plus one brightness grid
# (WIDTH x HEIGHT bytes) per portrait. Loaded once per process.
class PortraitBank
  WIDTH = PlaceholderFaces::WIDTH
  HEIGHT = PlaceholderFaces::HEIGHT
  CELLS = WIDTH * HEIGHT
  DIR = Rails.root.join("db/bank")

  attr_reader :tags

  def self.instance
    @instance ||= load
  end

  def self.load(dir = DIR)
    tags_path, grids_path = dir.join("traits.json"), dir.join("portraits.bin")
    if tags_path.exist? && grids_path.exist?
      new(JSON.parse(tags_path.read), grids_path.binread)
    else
      Rails.logger.warn("No portrait bank in #{dir}; drawing placeholder faces in memory")
      tags, grids = PlaceholderFaces.generate(150)
      new(tags, grids.join)
    end
  end

  def self.write(tags, grids, dir = DIR)
    FileUtils.mkdir_p(dir)
    dir.join("traits.json").write(JSON.generate(tags))
    dir.join("portraits.bin").binwrite(grids.join)
  end

  def initialize(tags, grids)
    raise ArgumentError, "grid data does not match #{tags.size} portraits" unless grids.bytesize == tags.size * CELLS
    @tags = tags
    @grids = grids
  end

  def size
    @tags.size
  end

  def grid(index)
    @grids.byteslice(index * CELLS, CELLS)
  end
end
