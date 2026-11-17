# The app's only table. One row per hunt whose visitor dropped a pin. It holds how far off we were,
# never where anyone is: no coordinates, no IP, no session token.
class CreateResults < ActiveRecord::Migration[8.1]
  def change
    create_table :results do |t|
      t.string :tier, null: false                  # doppler | mains | ip: what the final guess rested on
      t.integer :error_m, null: false              # our final guess to the visitor's pin
      t.integer :ip_error_m, null: false           # the IP prior's centre to the pin
      t.float :confidence, null: false, default: 0
      t.boolean :ambiguous, null: false, default: false
      t.integer :listened_s, null: false
      t.integer :cap_s, null: false
      t.integer :aircraft_scored, null: false, default: 0
      t.integer :passes_detected, null: false, default: 0
      t.integer :mains_hz
      t.datetime :created_at, null: false
    end
    add_index :results, :tier
  end
end
