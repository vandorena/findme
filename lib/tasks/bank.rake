namespace :bank do
  desc "Write a bank of procedurally drawn placeholder portraits to db/bank (COUNT=400)"
  task placeholder: :environment do
    count = Integer(ENV.fetch("COUNT", 400))
    tags, grids = PlaceholderFaces.generate(count)
    PortraitBank.write(tags, grids)
    puts "Wrote #{count} placeholder portraits to #{PortraitBank::DIR}"
  end
end
