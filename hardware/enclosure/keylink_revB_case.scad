// Keylink RevB - Parametric enclosure (Rev A)
// Units: mm

$fn = 48;

// -------------------- PARAMETERS --------------------
pcb_len = 40.0;        // measure from STEP
pcb_wid = 23.0;        // measure from STEP
pcb_thk = 1.6;

wall = 2.0;
floor = 2.0;

// Clearance
pcb_side_clear = 0.30; // per side
pcb_z_clear = 1.0;     // space above PCB plane before lid
rail_lip = 1.0;        // how much rail overlaps PCB edge
rail_height = pcb_thk + 0.3; // rail height above base floor

// Divider deck separating PCB and battery
deck_thk = 1.8;
deck_gap = 0.6;        // clearance between battery and deck (air gap)
pcb_to_deck = 1.0;     // space under PCB before deck (wires, solder)

// Battery (your candidate: 31 x 25 x 7)
bat_len = 31.0;
bat_wid = 25.0;
bat_thk = 7.0;
bat_clear_xy = 0.5;
bat_clear_z = 0.6;

// Case outer size
inner_len = pcb_len + 2*pcb_side_clear;
inner_wid = pcb_wid + 2*pcb_side_clear;

// Heights
pcb_plane_z = floor + pcb_to_deck + deck_thk + deck_gap + bat_thk + bat_clear_z;
inner_height = pcb_plane_z + pcb_thk + pcb_z_clear;   // interior height above floor
outer_height = inner_height + wall;

// End cutouts (placeholders - measure from STEP)
// USB-C at one end:
usbc_w = 10.0;
usbc_h = 4.0;
usbc_y_off = 0.0;      // offset from centerline if needed
// Audio jack at the other end:
jack_w = 8.0;
jack_h = 8.0;
jack_y_off = 0.0;

// Light pipe hole (measure LED XY from STEP)
// Coordinates relative to PCB origin at inside corner of case
led_x = 10.0;
led_y = 0.0;
lightpipe_d = 3.2;

// Battery side insert slot
slot_h = bat_thk + bat_clear_z + 1.0;
slot_w = bat_wid + bat_clear_xy;
slot_z = floor + 1.0; // from bottom

// -------------------- HELPERS --------------------
module rounded_box(x,y,z,r=2.0) {
  minkowski() {
    cube([x-2*r, y-2*r, z-2*r], center=false);
    sphere(r=r);
  }
}

module shell_base() {
  difference() {
    // Outer body
    rounded_box(inner_len + 2*wall, inner_wid + 2*wall, outer_height, r=2.0);

    // Hollow interior
    translate([wall, wall, floor])
      cube([inner_len, inner_wid, outer_height], center=false);
  }
}

module pcb_rails() {
  // Rails run along the long edges (length direction)
  // They form a channel the PCB slides into.
  rail_y0 = wall + pcb_side_clear;
  rail_y1 = wall + inner_wid - pcb_side_clear;

  // Left rail
  translate([wall, rail_y0 - rail_lip, pcb_plane_z])
    cube([inner_len, rail_lip, rail_height], center=false);

  // Right rail
  translate([wall, rail_y1, pcb_plane_z])
    cube([inner_len, rail_lip, rail_height], center=false);
}

module divider_deck() {
  // Deck across most of the case, leaving a battery region below
  translate([wall, wall, floor + pcb_to_deck])
    cube([inner_len, inner_wid, deck_thk], center=false);
}

module battery_pocket_cut() {
  // Pocket below the deck
  pocket_len = bat_len + bat_clear_xy;
  pocket_wid = bat_wid + bat_clear_xy;
  pocket_thk = bat_thk + bat_clear_z;

  // Put battery pocket centered, adjust if needed
  px = wall + (inner_len - pocket_len)/2;
  py = wall + (inner_wid - pocket_wid)/2;
  pz = floor;

  translate([px, py, pz])
    cube([pocket_len, pocket_wid, pocket_thk], center=false);
}

module battery_side_slot_cut() {
  // Slot through the case wall into battery pocket
  // Default: slot on the "right" side wall
  x0 = wall + (inner_len - (bat_len + bat_clear_xy))/2;
  y_wall = inner_wid + wall; // outer right wall
  z0 = slot_z;

  translate([x0, y_wall - 0.01, z0])
    cube([bat_len + bat_clear_xy, wall + 0.02, slot_h], center=false);
}

module end_cutouts() {
  // USB-C at +X end (front)
  translate([wall + inner_len - 0.01, wall + inner_wid/2 - usbc_w/2 + usbc_y_off, pcb_plane_z + pcb_thk/2 - usbc_h/2])
    cube([wall + 0.02, usbc_w, usbc_h], center=false);

  // Audio jack at -X end (back)
  translate([-0.01, wall + inner_wid/2 - jack_w/2 + jack_y_off, pcb_plane_z + pcb_thk/2 - jack_h/2])
    cube([wall + 0.02, jack_w, jack_h], center=false);
}

module lightpipe_cut() {
  // Hole through the lid area above the LED
  // LED position measured from inside corner (same orientation as PCB placement)
  lx = wall + pcb_side_clear + led_x;
  ly = wall + pcb_side_clear + led_y;
  lz = pcb_plane_z + pcb_thk + pcb_z_clear/2;

  translate([lx, ly, lz])
    rotate([90,0,0])
      cylinder(d=lightpipe_d, h=inner_wid + 2*wall, center=true);
}

// -------------------- BUILD --------------------
difference() {
  union() {
    shell_base();
    divider_deck();
    pcb_rails();
  }

  // Remove battery pocket volume
  battery_pocket_cut();

  // Battery insert slot
  battery_side_slot_cut();

  // End cutouts
  end_cutouts();

  // Lightpipe hole
  lightpipe_cut();
}

