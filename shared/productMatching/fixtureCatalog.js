// ===========================================================================
// FIXTURE CATALOG
// ===========================================================================
//
// A stand-in for any future real catalog (Wayfair, Rakuten, Amazon PA-API).
// It implements the CatalogSource interface in ./catalogSource.js, and it is
// the ONLY thing in this module that knows what a product looks like.
//
// Why a fixture is not a compromise here: ProductMatchingDesign.md Section 7
// establishes that two of the three v1 components - the deterministic
// rewriter and the ranking formula - depend only on the recommendation corpus
// and a candidate set. Both are fully testable with no commercial
// relationship in place. Only end-to-end RETRIEVAL QUALITY (recall against
// real catalog vocabulary) needs a live source, and that is the one
// measurement deliberately sequenced last.
//
// THE DESIGN CONSTRAINT THAT MAKES THIS FIXTURE USEFUL:
// product names here are what RETAILERS actually call things, never what
// Uncluttrd's AI calls them. The corpus says "tiered countertop organizer";
// this catalog says "3-Tier Kitchen Counter Shelf". If the fixture used the
// AI's vocabulary the matcher would score ~100% and prove nothing - the whole
// measured problem (Section 1: 62.8% of phrase pairs share zero tokens) is
// exactly this vocabulary gap.
//
// It also carries deliberate DISTRACTORS - wrong-category items and extreme
// price outliers - so ranking discrimination is measurable rather than
// assumed.
// ===========================================================================

const { tokenizeText, matchToken, productTokens } = require("./lexical");

const CURRENCY = "USD";
const MERCHANT = "fixture-home-goods";

const rows = [];

/**
 * @param name     retailer-style product title
 * @param category source category label
 * @param price    USD
 * @param description retailer-style copy
 * @param opts     { avail, commission, distractor }
 */
function p(name, category, price, description, opts = {}) {
  const idx = rows.length + 1;
  const id = `fx-${String(idx).padStart(4, "0")}`;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  rows.push({
    id,
    name,
    description,
    category,
    price,
    currency: CURRENCY,
    imageUrl: `https://fixture.invalid/img/${id}.jpg`,
    productUrl: `https://fixture.invalid/p/${slug}`,
    availability: opts.avail || "in_stock",
    sourceMetadata: {
      source: "fixture",
      merchantId: MERCHANT,
      affiliateUrl: `https://fixture.invalid/p/${slug}?aff=uncluttrd`,
      commission: opts.commission == null ? 0.05 : opts.commission,
    },
    // Not part of the CatalogProduct contract - test bookkeeping only, so the
    // evaluation harness can assert that distractors rank below real matches.
    _distractor: !!opts.distractor,
  });
}

// --- KITCHEN / PANTRY ORGANIZATION -----------------------------------------
p("3-Tier Kitchen Counter Shelf", "kitchen-organization", 34.99, "Three tier standing shelf rack for kitchen counters, pantry shelves and spice storage. Powder-coated steel.");
p("Expandable Bamboo Shelf Riser, Set of 2", "kitchen-organization", 42.5, "Adjustable width bamboo risers that double usable shelf height in cabinets and pantries.");
p("11-Inch Rotating Turntable Organizer", "kitchen-organization", 24.99, "Non-slip rotating turntable brings items at the back of a deep cabinet within reach.");
p("Double-Tier Rotating Corner Organizer", "kitchen-organization", 39.99, "Two-level rotating organizer for deep corner cabinets and pantry corners.");
p("Set of 2 Rotating Cabinet Turntables, 9-Inch", "kitchen-organization", 32.0, "Pair of rotating trays for cabinets, refrigerators and pantry shelving.");
p("Airtight Glass Storage Canister Set, 5-Piece", "kitchen-organization", 68.0, "Matching borosilicate canisters with bamboo lids and silicone seals for dry goods.");
p("Airtight Acrylic Pantry Container Set, 10-Piece", "kitchen-organization", 79.99, "Coordinated clear containers with airtight lids, stackable, for flour, sugar and cereal.");
p("Stackable Clear Pantry Bin, Set of 6", "kitchen-organization", 45.99, "Clear stackable bins with handles for pantry shelves and refrigerator organization.");
p("Pull-Out Cabinet Drawer Organizer, 2-Pack", "kitchen-organization", 56.0, "Sliding under-shelf drawers that convert fixed cabinet shelves into pull-out storage.");
p("Sliding Under-Shelf Basket, Chrome", "kitchen-organization", 18.99, "Slide-under wire basket adds a hidden layer of storage beneath any fixed shelf.");
p("Wire Storage Basket with Wood Handles", "storage-baskets", 27.99, "Open wire basket with solid wood handles for pantry, laundry and open shelving.");
p("Seagrass Woven Storage Basket, Large", "storage-baskets", 44.0, "Hand-woven seagrass basket with cotton rope handles for blankets, toys or pantry goods.");
p("Stackable Can Rack Organizer", "kitchen-organization", 22.5, "Holds up to 36 cans in a gravity-fed rack for pantry shelves.");
p("Spice Drawer Insert Organizer, Bamboo", "drawer-organizers", 29.99, "Angled bamboo insert holds spice jars visible and upright inside a standard drawer.");
p("Bamboo Drawer Divider Set, Adjustable", "drawer-organizers", 26.99, "Spring-loaded bamboo dividers section any drawer into custom compartments.");
p("Expandable Utensil Drawer Tray", "drawer-organizers", 21.99, "Expanding tray with divided compartments for cutlery, tools and kitchen utensils.");
p("Deep Drawer Organizer Bins, Set of 4", "drawer-organizers", 24.0, "Modular divided bins for deep kitchen and bathroom drawers.");
p("Acrylic Divided Vanity Drawer Tray", "drawer-organizers", 19.99, "Clear divided tray for cosmetics, jewellery and small bathroom items.");
p("Under-Sink Expandable Shelf Organizer", "kitchen-organization", 33.99, "Two-tier expandable rack that fits around plumbing under a sink.");
p("Cabinet Door Mounted Storage Rack", "kitchen-organization", 16.99, "Over-the-door wire rack for wraps, foils and cleaning supplies.");
p("Tiered Serving Stand, 3-Level Metal", "kitchen-organization", 48.0, "Three-tier stand for counter display of fruit, baked goods or bath items.", { avail: "unknown" });
p("Clear Stackable Shoe Box, Set of 12", "storage-bins", 52.0, "Stackable clear drop-front boxes for closet and entry storage.");
p("Refrigerator Bin Organizer Set, 8-Piece", "kitchen-organization", 38.99, "Clear fridge bins with handles in assorted widths.");
p("Pot Lid Rack Organizer, Adjustable", "kitchen-organization", 23.99, "Adjustable rack keeps pan lids upright in a cabinet or drawer.");
p("Pantry Shelf Liner, Non-Adhesive 12ft", "kitchen-organization", 14.99, "Cushioned non-slip liner for pantry and cabinet shelving.");

// --- STORAGE / BINS / BASKETS ----------------------------------------------
p("Fabric Storage Cube Bin, Set of 4", "storage-bins", 36.99, "Collapsible fabric cubes sized for standard cube shelving and bookcases.");
p("Collapsible Linen Storage Cube, 13-Inch", "storage-bins", 14.5, "Single linen-blend cube with reinforced sides and a fold-flat design.");
p("Cotton Rope Woven Basket with Handles", "storage-baskets", 34.0, "Soft coiled cotton rope basket for shelves, nurseries and living rooms.");
p("Jute Storage Basket, Set of 3 Nesting", "storage-baskets", 49.99, "Nesting jute baskets in graduated sizes with contrast stitching.");
p("Felt Storage Bin with Leather Handles", "storage-bins", 28.0, "Structured wool-felt bin that holds its shape on open shelving.");
p("Woven Water Hyacinth Basket, Rectangular", "storage-baskets", 39.5, "Natural woven basket sized for standard bookshelf cubbies.");
p("Canvas Storage Bin with Label Holder", "storage-bins", 19.99, "Sturdy canvas bin with a metal label frame on the front panel.");
p("Lidded Fabric Storage Box, Set of 2", "storage-bins", 41.0, "Fold-flat boxes with lids for closet-shelf and under-bed storage.");
p("Rattan Storage Basket with Lid", "storage-baskets", 58.0, "Lidded rattan basket that conceals clutter while reading as decor.");
p("Metal Wire Cube Bin, Matte Black", "storage-bins", 22.99, "Open wire bin with a modern matte finish for shelving units.");
p("Clear Stackable Storage Tote, 20qt", "storage-bins", 17.99, "Latching clear tote for closet, garage and seasonal storage.");
p("Under-Bed Storage Bag with Handles", "storage-bins", 24.99, "Zippered under-bed organizer with a clear top panel.");
p("Cotton Rope Basket, Small Round", "storage-baskets", 21.0, "Small coiled basket for entry keys, remotes or bathroom items.");
p("Woven Belly Basket, Natural", "storage-baskets", 32.0, "Slouchy woven basket for plants, throws and floor storage.");
p("Storage Ottoman with Lift Top", "storage-bins", 129.0, "Upholstered ottoman with concealed interior storage.");
p("Divided Closet Shelf Organizer, Hanging", "storage-bins", 26.5, "Six-shelf hanging organizer for folded clothing and accessories.");
p("Stackable Bookshelf Storage Cube, Set of 2", "storage-bins", 31.99, "Matching cubes sized for standard 13-inch bookshelf openings.");
p("Decorative Storage Basket with Liner", "storage-baskets", 37.0, "Woven basket with a removable cotton liner for shelf styling and storage.");

// --- SHELVING ---------------------------------------------------------------
p("Floating Wall Shelf, 24-Inch Walnut", "shelving", 46.0, "Solid wood floating shelf with concealed bracket for display and niches.");
p("Set of 3 Wall-Mounted Display Ledges", "shelving", 58.0, "Narrow picture ledges for leaning art, frames and small objects.");
p("Floating Corner Shelf, Set of 2", "shelving", 34.99, "Corner-mounted shelves for small display areas and awkward niches.");
p("Acrylic Riser Display Stand, Set of 3", "shelving", 29.99, "Graduated clear risers that lift objects to varied heights for display.");
p("Wood Pedestal Display Stand, Set of 2", "shelving", 42.0, "Turned wood pedestals for elevating vases, sculpture and books.");
p("Marble Book Riser, Pair", "shelving", 68.0, "Solid marble risers used as book stands or display pedestals.");
p("5-Tier Bookcase, Matte Black Metal", "shelving", 149.0, "Open-frame bookcase for living rooms and home offices.");
p("Ladder Shelf Bookcase, 4-Tier Oak", "shelving", 189.0, "Leaning ladder shelf with graduated depth shelves.");
p("Adjustable Cabinet Shelf Insert", "shelving", 18.99, "Stackable half-shelf that adds a level inside an existing cabinet.");
p("Niche Display Shelf, Brass Frame", "shelving", 72.0, "Small brass-framed shelf sized for recessed wall niches and alcoves.");
p("Wall Cube Shelf, Set of 3 White", "shelving", 44.5, "Floating cube shelves for grouped display arrangements.");
p("Over-Toilet Storage Shelf Unit", "shelving", 79.0, "Three-tier freestanding shelf that spans a standard toilet.");
p("Under-Shelf Hanging Rack, Set of 4", "shelving", 15.99, "Slide-on racks that add hanging storage beneath existing shelves.");
p("Industrial Pipe Wall Shelf, 36-Inch", "shelving", 88.0, "Reclaimed-look wood shelf on black iron pipe brackets.", { avail: "out_of_stock" });

// --- LIGHTING ---------------------------------------------------------------
p("Battery-Operated LED Puck Light, 6-Pack", "lighting", 26.99, "Wireless stick-on puck lights with remote dimming for shelves and cabinets.");
p("Rechargeable LED Picture Light, Brass", "lighting", 54.0, "Cordless rechargeable picture light for framed art and recessed niches.");
p("Battery Picture Light with Remote, Black", "lighting", 47.5, "Wireless art light with adjustable colour temperature and timer.");
p("Adhesive LED Strip Light with Motion Sensor", "lighting", 21.99, "Peel-and-stick rechargeable strip lighting for pantry shelves and closets.");
p("Under-Cabinet LED Light Bar, Wireless", "lighting", 32.99, "Battery-powered linear light bar with magnetic mounting.");
p("USB-Powered LED Shelf Strip, 6ft", "lighting", 18.99, "Plug-in adhesive strip lighting with inline dimmer for display shelving.");
p("3-Light Linear Pendant Chandelier", "lighting", 249.0, "Modern linear suspension fixture sized for dining tables and islands.");
p("Modern Sputnik Chandelier, 8-Light Brass", "lighting", 389.0, "Mid-century sputnik chandelier in aged brass for dining rooms.");
p("Woven Rattan Dome Pendant Light", "lighting", 168.0, "Natural rattan pendant shade for dining and entry ceilings.");
p("Glass Globe Pendant Light, Smoked", "lighting", 132.0, "Single smoked-glass globe pendant on an adjustable cord.");
p("Designer Sculptural Chandelier, Hand-Blown Glass", "lighting", 1890.0, "Limited-run hand-blown glass chandelier, made to order.", { commission: 0.09 });
p("Ceramic Table Lamp with Linen Shade", "lighting", 118.0, "Matte ceramic base table lamp for credenzas, consoles and sideboards.");
p("Small Accent Table Lamp, Brass and Marble", "lighting", 96.0, "Compact accent lamp sized for cabinet tops and narrow surfaces.");
p("Cordless Rechargeable Table Lamp, Dimmable", "lighting", 79.0, "Portable cordless lamp for surfaces without a nearby outlet.");
p("Arc Floor Lamp, Matte Black", "lighting", 209.0, "Overhanging arc floor lamp for reading corners.");
p("Clip-On Shelf Accent Light, Set of 2", "lighting", 24.0, "Small clip lights for illuminating bookshelves and display niches.");
p("Recessed Niche Spotlight, Warm White", "lighting", 38.0, "Low-profile directional light for alcoves and built-in niches.");
p("Smart LED Light Strip, 16ft Colour", "lighting", 34.99, "App-controlled colour strip lighting with adhesive backing.", { avail: "unknown" });
p("Wall Sconce with Frosted Shade, Pair", "lighting", 142.0, "Hardwired wall sconces for flanking mirrors and artwork.");
p("Motion-Sensor Closet Light, 3-Pack", "lighting", 19.99, "Battery motion lights for closets, pantries and cabinets.");

// --- CABLE MANAGEMENT -------------------------------------------------------
p("Cable Management Box with Lid, White", "cable-management", 27.99, "Conceals power strips and excess cord length on desks and media units.");
p("Desk Cable Organizer Tray with Clips", "cable-management", 22.5, "Under-desk tray that lifts cords off the floor, with routing clips.");
p("Charging Station Dock, 6-Device Bamboo", "cable-management", 44.99, "Multi-device charging station with integrated cord routing and hidden hub.");
p("Adhesive Cord Clips, 20-Pack", "cable-management", 9.99, "Small adhesive clips for routing cables along desks and walls.");
p("Neoprene Cable Pouch, Zippered", "cable-management", 16.99, "Soft zip pouch for storing chargers, adapters and loose cords.");
p("Cable Sleeve Wrap, 10ft Neoprene", "cable-management", 13.99, "Wraps multiple cables into a single tidy run.");
p("Under-Desk Cable Tray, Steel Mesh", "cable-management", 34.0, "Screw-mount steel basket for power bricks and cable slack.");
p("Cord Cover Floor Channel, 6ft", "cable-management", 18.5, "Low-profile floor channel that conceals cables across walkways.");
p("Velcro Cable Ties, 100-Pack", "cable-management", 8.99, "Reusable hook-and-loop ties for bundling cords.");
p("Cable Management Raceway Kit, Paintable", "cable-management", 24.99, "Wall-mounted channel kit for concealing TV and monitor cabling.");
p("Desktop Grommet Cable Organizer", "cable-management", 11.99, "Weighted silicone anchor that keeps loose cables on the desk surface.");
p("Power Strip with Integrated Cord Wrap", "cable-management", 29.99, "Surge-protected strip with a built-in cord spool.");

// --- TRAYS ------------------------------------------------------------------
p("Bamboo Serving Tray with Handles", "trays", 32.0, "Rectangular bamboo tray with cut-out handles for serving and surface styling.");
p("Round Marble Vanity Tray, 10-Inch", "trays", 44.0, "Polished marble tray for bathroom counters, perfume and soap.");
p("Black Metal Decorative Tray, 14-Inch", "trays", 28.5, "Matte black tray with a raised lip for corralling objects on a surface.");
p("Acacia Wood Bar Tray, Rectangular", "trays", 38.0, "Warm acacia tray sized for bottles and glassware on a credenza or cart.");
p("Mirrored Perfume Tray with Gold Trim", "trays", 34.99, "Mirrored vanity tray with a delicate metal gallery rail.");
p("Woven Rattan Tray, Round 16-Inch", "trays", 41.0, "Natural rattan tray for coffee tables and ottoman styling.");
p("Ceramic Catchall Dish, Matte White", "trays", 18.0, "Small shallow dish for keys, jewellery and bathroom counters.");
p("Leather Valet Tray, Stitched Edge", "trays", 46.0, "Folded leather tray for entry consoles and nightstands.");
p("Stackable Counter Tray, Set of 2", "trays", 25.99, "Nesting trays that group small items on a crowded counter.");
p("Wood and Brass Serving Tray, Large", "trays", 68.0, "Solid wood tray with inset brass handles for entertaining.");
p("Acrylic Clear Display Tray", "trays", 22.0, "Clear tray for bathroom, vanity and desk organization.", { avail: "unknown" });

// --- WALL ART ---------------------------------------------------------------
p("Framed Abstract Print, 16x20 Neutral", "wall-art", 58.0, "Framed abstract giclee print in a warm neutral palette with white mat.");
p("Set of 3 Framed Botanical Prints", "wall-art", 96.0, "Coordinated trio of framed botanical prints in matching thin black frames.");
p("9-Piece Gallery Wall Frame Set, Black", "wall-art", 89.99, "Mixed-size frame collection with a hanging template for gallery walls.");
p("Large Canvas Wall Art, 40x60 Abstract", "wall-art", 245.0, "Oversized gallery-wrapped canvas for large wall expanses.");
p("Framed Line Art Print, 11x14 Set of 2", "wall-art", 52.0, "Minimal single-line drawings in matching natural wood frames.");
p("Round Wall Mirror, Black Metal Frame 30-Inch", "wall-art", 128.0, "Circular mirror with a slim metal frame for dining rooms and entries.");
p("Arched Wall Mirror, Gold Frame", "wall-art", 189.0, "Arched decorative mirror that reads as artwork on a bare wall.");
p("Small Framed Print, 8x10 Neutral Abstract", "wall-art", 26.0, "Compact framed print sized for narrow walls and shelf leaning.");
p("Textured Canvas Diptych, Set of 2", "wall-art", 158.0, "Two-panel textured canvas set intended to hang as a pair.");
p("Woven Wall Hanging, Natural Fibre", "wall-art", 74.0, "Handwoven fibre wall hanging with wood dowel.");
p("Framed Vintage Botanical, 18x24", "wall-art", 82.0, "Reproduction botanical plate in an antique-finish frame.");
p("Metal Wall Sculpture, Abstract Brass", "wall-art", 134.0, "Dimensional brass wall sculpture for large blank walls.");
p("Gallery Frame Set, 7-Piece White", "wall-art", 68.0, "Coordinated white frames in assorted sizes for a grouped arrangement.");
p("Oversized Framed Landscape, 36x48", "wall-art", 298.0, "Large framed landscape photograph for dining and living rooms.", { avail: "out_of_stock" });

// --- DECOR ------------------------------------------------------------------
p("Ceramic Sculptural Vase, Matte White", "decor", 54.0, "Organic sculptural ceramic vase for styling shelves and consoles.");
p("Set of 3 Ceramic Decorative Objects", "decor", 62.0, "Coordinated sculptural objects in varied heights for shelf styling.");
p("Marble Decorative Bookends, Pair", "decor", 58.0, "Solid marble bookends with felt bases for shelves and desks.");
p("Brass Geometric Bookends, Modern Pair", "decor", 44.0, "Angular brass bookends for contemporary shelving.");
p("Brass Geometric Sculpture, Small", "decor", 38.0, "Small abstract brass form for shelf and tabletop styling.");
p("Low Ceramic Centerpiece Bowl, 14-Inch", "decor", 66.0, "Wide shallow bowl for dining table centerpieces and console styling.");
p("Sculptural Vase Set, 3-Piece Neutral", "decor", 78.0, "Trio of matte vases in graduated heights and organic silhouettes.");
p("Decorative Coffee Table Book Set of 3", "decor", 84.0, "Curated hardcover volumes chosen for spine colour and shelf styling.");
p("Travertine Decorative Object, Abstract", "decor", 72.0, "Carved stone object for layered shelf and coffee table arrangements.");
p("Glass Bud Vase Set, 5-Piece Amber", "decor", 32.0, "Small amber glass vases for grouped display.");
p("Wood Bead Garland with Tassel", "decor", 19.99, "Draped decorative garland for trays, shelves and baskets.");
p("Ceramic Ginger Jar, Blue and White", "decor", 88.0, "Classic lidded jar for console and mantel styling.");
p("Stone Decorative Sphere, Set of 3", "decor", 41.0, "Natural stone spheres for bowls and tray vignettes.");
p("Pillar Candle Holder Set, Matte Black", "decor", 36.0, "Graduated metal holders for pillar candles.");
p("Scented Soy Candle in Ceramic Vessel", "decor", 34.0, "Hand-poured candle in a reusable matte ceramic vessel.");
p("Unscented Pillar Candle Set of 6", "decor", 24.0, "Neutral pillar candles for styling trays and mantels.");
p("Decorative Storage Box, Lacquered", "decor", 52.0, "Lidded decorative box that conceals small items on open shelving.");
p("Abstract Ceramic Sculpture, Cream", "decor", 96.0, "Statement sculptural piece for niches and shelf focal points.");
p("Sculptural Taper Candle Holder, Pair", "decor", 48.0, "Curved brass holders for taper candles.");
p("Faux Olive Branch Stems, Set of 3", "decor", 28.0, "Realistic faux stems for tall vases and floor vessels.");
p("Designer Murano Glass Sculpture, Limited Edition", "decor", 2400.0, "Signed hand-blown Murano art glass, numbered edition.", { commission: 0.1, distractor: true });

// --- TEXTILES ---------------------------------------------------------------
p("Turkish Cotton Hand Towel, Beige", "textiles", 22.0, "Absorbent Turkish cotton hand towel with woven stripe detail.");
p("Waffle Weave Hand Towel, Set of 2", "textiles", 28.0, "Quick-drying waffle cotton hand towels in warm neutrals.");
p("6-Piece Egyptian Cotton Bath Towel Set", "textiles", 128.0, "Long-staple Egyptian cotton bath sheets, hand towels and washcloths.");
p("Plush Bath Towel Set, 6-Piece Spa", "textiles", 96.0, "Heavyweight 700gsm towel set in a coordinated neutral palette.");
p("Memory Foam Bath Mat, Plush Gray", "textiles", 34.0, "Thick memory foam mat with a non-slip backing.");
p("Cotton Tufted Bath Mat, Beige", "textiles", 29.99, "Dense tufted cotton mat in a warm sand tone.");
p("Chunky Knit Throw Blanket, Oatmeal", "textiles", 68.0, "Oversized knit throw for sofas and beds.");
p("Linen Table Runner, Natural 90-Inch", "textiles", 42.0, "Washed linen runner for dining tables and credenzas.");
p("Woven Cotton Area Rug, 5x7 Neutral", "textiles", 189.0, "Flatweave cotton rug in a low-contrast neutral pattern.");
p("Jute Area Rug, 8x10 Natural", "textiles", 298.0, "Hand-woven jute rug that anchors dining and living zones.");
p("Velvet Throw Pillow Cover, Set of 2", "textiles", 38.0, "Coordinating velvet covers in muted tones.");
p("Hand-Knotted Persian Silk Rug, 9x12", "textiles", 8500.0, "Museum-grade hand-knotted silk rug, single piece.", { commission: 0.08, distractor: true });

// --- FURNITURE --------------------------------------------------------------
p("Mid-Century Bar Cabinet with Wine Rack", "furniture", 549.0, "Walnut bar cabinet with bottle storage, stemware rack and interior shelving.");
p("Liquor Cabinet with Locking Doors", "furniture", 689.0, "Freestanding drinks cabinet with lockable doors and adjustable shelves.");
p("Sideboard Credenza, 60-Inch Walnut", "furniture", 798.0, "Low credenza with sliding doors for dining and living room storage.");
p("Bar Cart, Brass and Glass 2-Tier", "furniture", 218.0, "Rolling two-tier cart for bottles, glassware and barware.");
p("Accent Cabinet with Cane Doors", "furniture", 429.0, "Compact storage cabinet with woven cane door fronts.");
p("Console Table with Lower Shelf", "furniture", 289.0, "Narrow console for entries and behind-sofa placement.");
p("Storage Bench with Cushion, Entry", "furniture", 249.0, "Upholstered bench with interior storage for entryways.");
p("Nightstand with Two Drawers, Oak", "furniture", 219.0, "Two-drawer bedside table in white oak veneer.");
p("Commercial Restaurant Prep Table, Stainless", "furniture", 899.0, "NSF-certified stainless steel commercial prep table.", { distractor: true });
p("Dog Crate Furniture End Table", "furniture", 279.0, "Wooden end table that conceals a pet crate.", { distractor: true });

// --- HOOKS ------------------------------------------------------------------
p("Adhesive Wall Hooks, 12-Pack Matte Black", "hooks", 14.99, "Damage-free adhesive hooks for towels, bags and keys.");
p("Brass Wall Hook Rail, 5-Hook", "hooks", 42.0, "Solid brass hook rail on a wood backplate for entries and mudrooms.");
p("Over-the-Door Hook Rack, 6-Hook", "hooks", 19.99, "Slim over-door rack requiring no hardware.");
p("Cabinet Door Towel Bar, Chrome", "hooks", 12.99, "Slide-on bar for hanging towels inside a cabinet door.");
p("Ceramic Knob Wall Hooks, Set of 3", "hooks", 26.0, "Decorative ceramic knob hooks for bathrooms and bedrooms.");
p("Heavy-Duty Garage Utility Hooks, 8-Pack", "hooks", 24.99, "Rubber-coated steel hooks rated for tools and equipment.", { distractor: true });

// --- PLANTS -----------------------------------------------------------------
p("Faux Succulent in Ceramic Pot, 6-Inch", "plants", 24.0, "Realistic faux succulent in a matte ceramic planter for shelves and counters.");
p("Small Faux Potted Plant, Set of 3", "plants", 38.0, "Trio of small artificial plants in coordinated pots.");
p("Live Snake Plant in Nursery Pot, 10-Inch", "plants", 32.0, "Low-light tolerant live plant suited to bathrooms and offices.");
p("Faux Eucalyptus Stems in Glass Vase", "plants", 46.0, "Pre-arranged faux stems in a clear vessel.");
p("Ceramic Planter with Drainage, 8-Inch", "plants", 29.0, "Glazed planter with saucer for live houseplants.");
p("Hanging Planter with Macrame Cord", "plants", 27.99, "Ceramic hanging pot with a cotton macrame hanger.");
p("Faux Fiddle Leaf Fig Tree, 5ft", "plants", 148.0, "Tall artificial tree in a weighted basket base.");
p("Small Terracotta Pot Set of 4", "plants", 19.99, "Classic terracotta pots for windowsills and counters.");

// --- BARWARE ----------------------------------------------------------------
p("Crystal Decanter with Stopper", "barware", 78.0, "Lead-free crystal decanter for spirits and display.");
p("Cocktail Shaker Set, 8-Piece Gold", "barware", 54.0, "Complete bar tool set with stand.");
p("Lowball Glass Set of 6, Ribbed", "barware", 46.0, "Textured rocks glasses for bar carts and cabinets.");
p("Marble and Wood Coaster Set of 4", "barware", 32.0, "Mixed-material coasters with a matching holder.");
p("Ice Bucket with Tongs, Brushed Brass", "barware", 68.0, "Insulated bucket for bar cart and cabinet styling.");
p("Wine Rack Insert, 6-Bottle Wood", "barware", 39.0, "Drop-in rack that adds bottle storage to a cabinet shelf.");

// --- LABELS -----------------------------------------------------------------
p("Label Maker with Bluetooth and Multiple Fonts", "labels", 49.99, "Rechargeable thermal label printer with app-selectable fonts and symbols.");
p("Handheld Label Maker with QWERTY Keyboard", "labels", 34.99, "Standalone label printer with built-in font and border options.");
p("Waterproof Adhesive Pantry Labels, 150-Pack", "labels", 12.99, "Pre-printed and blank waterproof labels for jars and bins.");
p("Clear Vinyl Label Set, Minimalist Pantry", "labels", 16.5, "Transparent pre-printed labels for canisters and containers.");
p("Chalkboard Label Stickers, 60-Pack", "labels", 9.99, "Reusable chalk-surface labels with a marker included.");
p("Metal Basket Label Clips, Set of 8", "labels", 18.0, "Clip-on frames for labelling wire and woven baskets.");
p("Thermal Label Refill Tape, 3-Pack", "labels", 21.99, "Replacement adhesive tape cartridges.", { avail: "unknown" });

// --- BATH ACCESSORIES -------------------------------------------------------
p("Ceramic Soap Dispenser and Tumbler Set", "bath-accessories", 42.0, "Matching matte ceramic dispenser, tumbler and dish in a coordinated glaze.");
p("Matte Black Bathroom Accessory Set, 4-Piece", "bath-accessories", 56.0, "Coordinated soap dispenser, toothbrush holder, tray and dish.");
p("Glass Soap Dispenser with Brass Pump", "bath-accessories", 28.0, "Refillable amber glass dispenser with a metal pump.");
p("Stoneware Soap Dish, Speckled", "bath-accessories", 16.0, "Handmade-look stoneware dish with drainage ridges.");
p("Bathroom Counter Organizer, 2-Tier", "bath-accessories", 38.99, "Two-level counter organizer for vanity and countertop items.");
p("Freestanding Toilet Paper Holder with Storage", "bath-accessories", 44.0, "Slim stand with concealed spare-roll storage.");

// --- DISTRACTORS: wrong category entirely -----------------------------------
p("Garden Hose Reel Cart, 250ft Capacity", "outdoor", 129.0, "Wheeled hose reel with a brass swivel connector.", { distractor: true });
p("Car Windshield Phone Mount, Suction", "automotive", 24.99, "Adjustable dashboard and windshield phone holder.", { distractor: true });
p("Treadmill Desk Converter, Electric", "fitness", 449.0, "Height-adjustable walking desk platform.", { distractor: true });
p("Baby Bottle Drying Rack, Grass Design", "baby", 18.99, "Countertop drying rack for bottles and pump parts.", { distractor: true });
p("Industrial Steel Shelving Unit, 6000lb Capacity", "industrial", 649.0, "Boltless rivet shelving for warehouse and garage loads.", { distractor: true });
p("Snow Shovel with Ergonomic Handle", "outdoor", 39.99, "Bent-shaft shovel with a wear strip.", { distractor: true });
p("Aquarium Gravel Vacuum Siphon", "pet", 22.5, "Water-change siphon for freshwater tanks.", { distractor: true });
p("Cordless Drill Driver Kit, 20V", "tools", 119.0, "Two-battery drill kit with a hard case.", { distractor: true });
p("Laptop Cooling Pad with Fans", "electronics", 32.99, "Five-fan cooling stand for gaming laptops.", { distractor: true });
p("Yoga Mat with Alignment Lines, 6mm", "fitness", 48.0, "Non-slip TPE mat with carrying strap.", { distractor: true });
p("Wall-Mounted Bike Storage Rack", "outdoor", 54.0, "Horizontal bike hanger with a wood shelf.", { distractor: true });
p("Electric Pressure Washer, 2000 PSI", "outdoor", 189.0, "Compact electric washer with four nozzle tips.", { distractor: true });

// ---------------------------------------------------------------------------
// The source object. This is the entire public surface.
// ---------------------------------------------------------------------------

const byId = new Map(rows.map((r) => [r.id, r]));

// Very deliberately a NAIVE lexical search: token overlap against name,
// description and category, with no stemming beyond what the rewriter already
// did and no synonym expansion.
//
// That is the point. A real catalog's search endpoint is a black box we do not
// control, and over-engineering the fixture's retrieval would flatter the
// pipeline by hiding how much work the REWRITER has to do. If matching only
// works because the fixture search is clever, it will not survive contact with
// a real source.
// RETRIEVAL SEMANTICS, and this turned out to matter more than anything else
// measured here.
//
// `strict: true` requires EVERY query token to appear (AND-semantics), which
// is how a structured catalog API with a real category tree behaves. The
// default is OR-semantics: any token hit qualifies, ranked by coverage.
//
// Evaluating both revealed that the default was flattering the pipeline badly.
// Measured against all 54 recommendations:
//
//                            no rewrite     with rewriter
//   OR-semantics             51/54 (94%)    54/54 (100%)     +3
//   AND-semantics            20/54 (37%)    37/54 (69%)     +17
//
// Under forgiving OR retrieval the rewriter looks nearly worthless. Under
// realistic AND retrieval it nearly doubles coverage. The first reading is an
// artifact of the fixture being generous, not a fact about the rewriter - and
// it is exactly the kind of self-inflicted measurement error that building
// against a fixture is supposed to surface before a real integration hides it.
function search(query, options = {}) {
  const maxResults = options.maxResults == null ? 50 : options.maxResults;
  const range = options.priceRange || {};
  const strict = !!options.strict;
  // Tokenized and normalized through the same path the products are, so both
  // sides of every comparison agree on what a word is. Previously this used
  // String.includes(), which matched inside words - see lexical.js.
  const terms = tokenizeText(query);
  if (!terms.length) return [];

  const scored = [];
  for (const r of rows) {
    if (range.min != null && r.price < range.min) continue;
    if (range.max != null && r.price > range.max) continue;

    const F = productTokens(r);

    let hits = 0;
    let weighted = 0;
    for (const t of terms) {
      const inName = matchToken(F.name, t);
      const inDesc = matchToken(F.description, t);
      const inCat = matchToken(F.category, t);
      if (inName || inDesc || inCat) hits++;
      // Title matches count for more than description matches, which is how
      // every retailer search engine behaves.
      weighted += (inName ? 3 : 0) + (inCat ? 2 : 0) + (inDesc ? 1 : 0);
    }
    if (!hits) continue;
    if (strict && hits < terms.length) continue; // AND-semantics
    scored.push({ product: r, hits, weighted, coverage: hits / terms.length });
  }

  scored.sort((a, b) =>
    b.coverage - a.coverage || b.weighted - a.weighted || a.product.price - b.product.price);

  return scored.slice(0, maxResults).map((s) => s.product);
}

function getProduct(id) {
  return byId.get(id) || null;
}

const FixtureCatalogSource = {
  metadata: {
    name: "fixture-home-goods",
    type: "fixture",
    lastUpdated: "2026-08-18T00:00:00Z",
  },
  search,
  getProduct,
};

module.exports = { FixtureCatalogSource, ALL_PRODUCTS: rows };
