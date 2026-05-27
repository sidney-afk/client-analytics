"""Generate competitors CSV for SYNCVIEW Competitors tab import."""
import csv, io

SCRAPED_DATE = "2026-05-27"
PLATFORM = "instagram"

def url(handle):
    return f"https://www.instagram.com/{handle.lstrip('@')}/"

ROWS = [
    # Morgan Burch
    ["Morgan Burch", 1, "Dr. Tracy D", "@drtracyd", url("drtracyd"), PLATFORM,
     "Dr. Tracy D is a psychologist and relationship coach for women who posts about attachment wounds, self-worth, and healing from toxic relationships. Her content blends clinical expertise with relatable storytelling, making her a direct peer in the therapy-meets-coaching space.",
     SCRAPED_DATE],
    ["Morgan Burch", 2, "The Gottman Institute", "@gottmaninstitute", url("gottmaninstitute"), PLATFORM,
     "The Gottman Institute produces research-backed content on couples communication, conflict resolution, and emotional attunement. Their high-credibility brand targets both individual couples and relationship professionals seeking evidence-based frameworks.",
     SCRAPED_DATE],
    ["Morgan Burch", 3, "The Secure Relationship", "@thesecurerelationship", url("thesecurerelationship"), PLATFORM,
     "The Secure Relationship is an attachment-focused coaching account teaching audiences to identify their attachment style and build emotionally secure partnerships. Content covers healing anxious and avoidant patterns through practical, digestible reels and carousels.",
     SCRAPED_DATE],

    # Baya Voce
    ["Baya Voce", 1, "Dr. Tracy D", "@drtracyd", url("drtracyd"), PLATFORM,
     "Dr. Tracy D is a psychologist and relationship coach for women who posts about attachment wounds, self-worth, and healing from toxic relationships. Her content blends clinical expertise with relatable storytelling, making her a direct peer in the therapy-meets-coaching space.",
     SCRAPED_DATE],
    ["Baya Voce", 2, "The Secure Relationship", "@thesecurerelationship", url("thesecurerelationship"), PLATFORM,
     "The Secure Relationship is an attachment-focused coaching account teaching audiences to identify their attachment style and build emotionally secure partnerships. Content covers healing anxious and avoidant patterns through practical, digestible reels and carousels.",
     SCRAPED_DATE],
    ["Baya Voce", 3, "Embracing Joy Psychotherapy", "@embracingjoypsychotherapy", url("embracingjoypsychotherapy"), PLATFORM,
     "Embracing Joy Psychotherapy shares accessible mental-health and relationship content grounded in psychotherapy principles. Their Instagram targets women seeking emotional wellness tools, overlapping closely with Baya Voce's communication and connection niche.",
     SCRAPED_DATE],

    # Jesse Israel
    ["Jesse Israel", 1, "Hannah Barrett", "@hannahbarrettyoga", url("hannahbarrettyoga"), PLATFORM,
     "Hannah Barrett is a yoga and mindfulness teacher whose Instagram content centers on breathwork, meditation, and nervous-system regulation. Her approachable, community-focused style closely mirrors Jesse Israel's mass-meditation and mindfulness mission.",
     SCRAPED_DATE],
    ["Jesse Israel", 2, "Growth of Mind", "@growthof_mind", url("growthof_mind"), PLATFORM,
     "Growth of Mind is a mindfulness and personal-growth account sharing motivational content around conscious living and mental clarity. Their broad, engaged following in the meditation-adjacent space makes them a relevant competitor for Jesse Israel's audience.",
     SCRAPED_DATE],
    ["Jesse Israel", 3, "Chelsea Loves Yoga", "@chelsealovesyoga", url("chelsealovesyoga"), PLATFORM,
     "Chelsea Loves Yoga creates yoga and mindfulness content that blends movement, breathwork, and stress-relief practices. Her warm community-building approach and focus on accessible wellness parallels Jesse Israel's ethos of making meditation mainstream.",
     SCRAPED_DATE],

    # Jessica Winterstern
    ["Jessica Winterstern", 1, "Estars Universe", "@estarsuniverse", url("estarsuniverse"), PLATFORM,
     "Estars Universe covers spiritual awakening, the feminine divine, and mystical practices with an Instagram presence that draws a deeply engaged community of seekers. Their content on sacred femininity and higher consciousness overlaps directly with Jessica Winterstern's niche.",
     SCRAPED_DATE],
    ["Jessica Winterstern", 2, "Amanda Ferguson", "@mrsamandaferguson", url("mrsamandaferguson"), PLATFORM,
     "Amanda Ferguson is a feminine-energy and relationship coach whose content helps women embody their authentic power in love and life. Her coaching style around polarity and feminine embodiment places her in direct competition with Jessica Winterstern's audience.",
     SCRAPED_DATE],
    ["Jessica Winterstern", 3, "No Nonsense Spirituality", "@nononsensespirituality", url("nononsensespirituality"), PLATFORM,
     "No Nonsense Spirituality demystifies spiritual concepts for a modern audience, covering topics from energy work to intuition development. Their grounded yet expansive approach to spirituality serves a similar demographic to Jessica Winterstern's feminine-spiritual brand.",
     SCRAPED_DATE],

    # John Wineland
    ["John Wineland", 1, "Lorin Krenn", "@lorinkrenn", url("lorinkrenn"), PLATFORM,
     "Lorin Krenn is a relationship and polarity coach teaching masculine-feminine dynamics, emotional depth, and relational intimacy. His content on men's leadership in relationships and conscious partnership directly overlaps with John Wineland's core curriculum.",
     SCRAPED_DATE],
    ["John Wineland", 2, "Adam Allred", "@adamallredofficial", url("adamallredofficial"), PLATFORM,
     "Adam Allred creates men's-work content focused on emotional embodiment, masculine purpose, and authentic leadership. His Instagram targets the same archetype of growth-oriented men that form the core of John Wineland's audience.",
     SCRAPED_DATE],
    ["John Wineland", 3, "Rafael Bielak", "@rafael.bielak", url("rafael.bielak"), PLATFORM,
     "Rafael Bielak is a men's coach covering relationship dynamics, masculine identity, and personal development for high-achieving men. His focus on integrating strength with emotional intelligence puts him squarely in John Wineland's competitive landscape.",
     SCRAPED_DATE],

    # Chelsey Scaffidi
    ["Chelsey Scaffidi", 1, "The Mindful Blonde", "@themindfulblonde", url("themindfulblonde"), PLATFORM,
     "The Mindful Blonde blends mindfulness, holistic wellness, and lifestyle content for women seeking a more intentional life. Her aesthetic and topic mix of mental clarity, nutrition, and self-care practices closely mirrors Chelsey Scaffidi's wellness positioning.",
     SCRAPED_DATE],
    ["Chelsey Scaffidi", 2, "Midi", "@midiforreal", url("midiforreal"), PLATFORM,
     "Midi is a women's health and wellness platform sharing content on hormones, perimenopause, and holistic wellbeing for women 40+. Their medically informed but accessible approach appeals to a similar health-conscious female audience as Chelsey Scaffidi.",
     SCRAPED_DATE],
    ["Chelsey Scaffidi", 3, "Masha Speaches Fit", "@mashaspeachesfit_", url("mashaspeachesfit_"), PLATFORM,
     "Masha Speaches Fit creates fitness and wellness content for women, combining workout routines with body-positive messaging. Her blend of physical health and mindset work competes for the same female wellness audience that Chelsey Scaffidi cultivates.",
     SCRAPED_DATE],

    # Adriana Rizzolo
    ["Adriana Rizzolo", 1, "Saad Simone", "@sahdsimone", url("sahdsimone"), PLATFORM,
     "Saad Simone is a somatic healer and spiritual teacher who shares content on nervous-system healing, trauma release, and embodied spirituality. His emotionally resonant storytelling and depth-oriented audience overlap directly with Adriana Rizzolo's somatic love work.",
     SCRAPED_DATE],
    ["Adriana Rizzolo", 2, "Jani Breathwork & Healing", "@jani.breathwork.healing", url("jani.breathwork.healing"), PLATFORM,
     "Jani Breathwork & Healing offers breathwork and somatic healing content focused on releasing stored trauma and opening the heart. Their content bridges spirituality and body-based healing in the same space Adriana Rizzolo occupies.",
     SCRAPED_DATE],
    ["Adriana Rizzolo", 3, "Heal with Francesca", "@healwithfrancesca", url("healwithfrancesca"), PLATFORM,
     "Heal with Francesca is a trauma-informed healing and nervous-system regulation account combining somatic practices with emotional depth. Her audience of women seeking body-based healing and heart-opening work aligns closely with Adriana Rizzolo's niche.",
     SCRAPED_DATE],

    # Lauren Taus
    ["Lauren Taus", 1, "Saad Simone", "@sahdsimone", url("sahdsimone"), PLATFORM,
     "Saad Simone is a somatic healer and spiritual teacher sharing content on nervous-system healing, trauma release, and embodied spirituality. His depth-oriented community mirrors the IFS and somatic therapy audience Lauren Taus cultivates.",
     SCRAPED_DATE],
    ["Lauren Taus", 2, "Jani Breathwork & Healing", "@jani.breathwork.healing", url("jani.breathwork.healing"), PLATFORM,
     "Jani Breathwork & Healing produces breathwork and somatic healing content for audiences seeking trauma release and emotional opening. Their focus on body-based healing practices runs parallel to Lauren Taus's somatic and IFS therapy work.",
     SCRAPED_DATE],
    ["Lauren Taus", 3, "Heal with Francesca", "@healwithfrancesca", url("healwithfrancesca"), PLATFORM,
     "Heal with Francesca delivers trauma-informed somatic healing content combining nervous-system regulation with emotional processing. Her overlap with body-centered therapeutic approaches makes her a direct peer to Lauren Taus's therapy and coaching brand.",
     SCRAPED_DATE],

    # Jordan Marks
    ["Jordan Marks", 1, "Saad Simone", "@sahdsimone", url("sahdsimone"), PLATFORM,
     "Saad Simone is a somatic healer and spiritual teacher sharing content on nervous-system healing, trauma release, and embodied spirituality. His work on the mind-body connection directly competes for Jordan Marks's audience of people seeking somatic and consciousness-based transformation.",
     SCRAPED_DATE],
    ["Jordan Marks", 2, "Jani Breathwork & Healing", "@jani.breathwork.healing", url("jani.breathwork.healing"), PLATFORM,
     "Jani Breathwork & Healing creates breathwork and body-based healing content that helps audiences process stored emotion and expand awareness. Their somatic approach overlaps with Jordan Marks's mind-body integration and healing work.",
     SCRAPED_DATE],
    ["Jordan Marks", 3, "Heal with Francesca", "@healwithfrancesca", url("healwithfrancesca"), PLATFORM,
     "Heal with Francesca is a trauma-informed healing account covering nervous-system regulation and somatic practices. Her community of women doing body-based healing work sits squarely within Jordan Marks's competitive landscape.",
     SCRAPED_DATE],

    # Alyssa Nobriga
    ["Alyssa Nobriga", 1, "The Fascia Movement", "@thefasciamovement", url("thefasciamovement"), PLATFORM,
     "The Fascia Movement educates audiences on somatic health, fascial release, and body-based healing practices. Their content on connective tissue, trauma storage, and embodiment overlaps directly with Alyssa Nobriga's somatic coaching approach.",
     SCRAPED_DATE],
    ["Alyssa Nobriga", 2, "Sarah Jackson Coaching", "@sarahjacksoncoaching", url("sarahjacksoncoaching"), PLATFORM,
     "Sarah Jackson Coaching produces nervous-system and somatic regulation content for high-achieving women seeking to heal burnout and anxiety. Her coaching focus on embodiment and inner safety closely parallels Alyssa Nobriga's transformational methodology.",
     SCRAPED_DATE],
    ["Alyssa Nobriga", 3, "Heal with Francesca", "@healwithfrancesca", url("healwithfrancesca"), PLATFORM,
     "Heal with Francesca delivers trauma-informed somatic healing content combining nervous-system regulation with emotional processing. Her focus on body-based transformation and inner healing makes her a peer in Alyssa Nobriga's consciousness-coaching space.",
     SCRAPED_DATE],

    # Melissa Pruett
    ["Melissa Pruett", 1, "Maia Henry", "@maiahenryfit", url("maiahenryfit"), PLATFORM,
     "Maia Henry is a fitness and Pilates creator sharing sculpting workouts and body-positive wellness content for women. Her aesthetic-focused fitness approach and female audience demographic place her in direct competition with Melissa Pruett's sculpting brand.",
     SCRAPED_DATE],
    ["Melissa Pruett", 2, "Pilates Andor", "@pilatesandor", url("pilatesandor"), PLATFORM,
     "Pilates Andor creates Pilates and body-sculpting content for women seeking a lean, toned physique through low-impact training. Their workout style and target demographic closely mirror Melissa Pruett's melt-method fitness niche.",
     SCRAPED_DATE],
    ["Melissa Pruett", 3, "Fit with Dora", "@fit_withdora", url("fit_withdora"), PLATFORM,
     "Fit with Dora offers fitness and Pilates-inspired workout content for women focused on toning and body confidence. Her blend of accessible sculpting routines and motivational wellness messaging competes for the same audience as Melissa Pruett.",
     SCRAPED_DATE],

    # Danielle Robin
    ["Danielle Robin", 1, "David Meessen", "@david_meessen", url("david_meessen"), PLATFORM,
     "David Meessen is a dating and relationship coach sharing content on attraction, communication, and building healthy romantic connections. His practical and psychology-informed dating advice targets a similar audience as Danielle Robin's relationship-coaching brand.",
     SCRAPED_DATE],
    ["Danielle Robin", 2, "Cam Dating", "@cam_dating", url("cam_dating"), PLATFORM,
     "Cam Dating produces dating-advice content focused on modern relationship dynamics, attraction, and communication strategies. Their audience of singles and daters seeking practical guidance overlaps with Danielle Robin's relationship-coaching demographic.",
     SCRAPED_DATE],
    ["Danielle Robin", 3, "Benjamin Seda", "@realbenjaminseda", url("realbenjaminseda"), PLATFORM,
     "Benjamin Seda is a dating and relationship coach creating content on attraction, confidence, and building meaningful romantic connections. His coaching philosophy and target audience of people seeking love and deeper relationships align closely with Danielle Robin's brand.",
     SCRAPED_DATE],

    # Doug Cartwright
    ["Doug Cartwright", 1, "Cory Muscara", "@corymuscara", url("corymuscara"), PLATFORM,
     "Cory Muscara is a mindfulness and consciousness coach known for making meditation and self-awareness practices accessible to a broad audience. His focus on inner transformation and high-performance living closely parallels Doug Cartwright's personal-development brand.",
     SCRAPED_DATE],
    ["Doug Cartwright", 2, "Gabe Martinelli", "@gabemartinelli", url("gabemartinelli"), PLATFORM,
     "Gabe Martinelli creates motivational and business-coaching content targeting entrepreneurs and growth-oriented professionals. His blend of mindset work and practical business insight competes for the same ambitious personal-development audience as Doug Cartwright.",
     SCRAPED_DATE],
    ["Doug Cartwright", 3, "Dr. Shante", "@drshantesays", url("drshantesays"), PLATFORM,
     "Dr. Shante is a mental health and relationship expert sharing psychology-backed content on emotional wellness and self-growth. Her credible, relatable approach to personal development and relationships places her in Doug Cartwright's competitive set.",
     SCRAPED_DATE],

    # Dr. Rocco Piazza
    ["Dr. Rocco Piazza", 1, "Dr. Stuart Linder", "@drstuartlinder", url("drstuartlinder"), PLATFORM,
     "Dr. Stuart Linder is a Beverly Hills board-certified plastic surgeon creating educational and behind-the-scenes content on cosmetic procedures. His high production value and expert positioning in elective surgery directly compete with Dr. Rocco Piazza's cosmetic surgery brand.",
     SCRAPED_DATE],
    ["Dr. Rocco Piazza", 2, "Dr. Daniel Barrett", "@drdanielbarrett", url("drdanielbarrett"), PLATFORM,
     "Dr. Daniel Barrett is a board-certified plastic surgeon known for transparent, educational content on body and facial cosmetic procedures. His direct-to-consumer communication style and focus on natural results mirror Dr. Rocco Piazza's aesthetic-surgery approach.",
     SCRAPED_DATE],
    ["Dr. Rocco Piazza", 3, "Dr. Thomas Sterry MD FACS", "@drsterry", url("drsterry"), PLATFORM,
     "Dr. Thomas Sterry MD FACS is a New York-based plastic surgeon sharing expert content on cosmetic and reconstructive procedures. His professional credibility and patient-education focus place him in direct competition with Dr. Rocco Piazza in the high-end cosmetic surgery space.",
     SCRAPED_DATE],

    # Mastin Kipp
    ["Mastin Kipp", 1, "The Workout Witch", "@theworkoutwitch_", url("theworkoutwitch_"), PLATFORM,
     "The Workout Witch blends fitness, mindset, and spiritual wellness content for women seeking holistic transformation. Their mind-body approach to healing and growth overlaps with Mastin Kipp's trauma-informed personal-development and wellness brand.",
     SCRAPED_DATE],
    ["Mastin Kipp", 2, "Heal with Francesca", "@healwithfrancesca", url("healwithfrancesca"), PLATFORM,
     "Heal with Francesca produces trauma-informed healing content combining somatic practices with emotional depth and spiritual growth. Her focus on nervous-system healing and inner transformation competes for Mastin Kipp's audience of people seeking deep personal change.",
     SCRAPED_DATE],
    ["Mastin Kipp", 3, "Dr. Frank Anderson", "@frank_andersonmd", url("frank_andersonmd"), PLATFORM,
     "Dr. Frank Anderson is a trauma and IFS (Internal Family Systems) psychiatrist sharing clinical yet accessible content on healing trauma and healing the nervous system. His credibility-driven approach to trauma recovery places him in Mastin Kipp's therapeutic personal-development space.",
     SCRAPED_DATE],

    # Edward Mannix
    ["Edward Mannix", 1, "Mariia Healing Light", "@mariia_healing_light", url("mariia_healing_light"), PLATFORM,
     "Mariia Healing Light creates energy healing and Reiki content for audiences drawn to subtle-body work and spiritual wellness. Her focus on vibrational healing and intuitive energy practices directly parallels Edward Mannix's energy-healing and spiritual-guidance brand.",
     SCRAPED_DATE],
    ["Edward Mannix", 2, "North & Soul", "@northandsoul", url("northandsoul"), PLATFORM,
     "North & Soul produces Kundalini yoga and energy-healing content for seekers of spiritual expansion and inner power. Their blend of ancient practice and modern wellness storytelling competes for Edward Mannix's audience of spiritually curious energy-healing followers.",
     SCRAPED_DATE],
    ["Edward Mannix", 3, "Healing and Beyond", "@healing.and.beyond", url("healing.and.beyond"), PLATFORM,
     "Healing and Beyond delivers ASMR Reiki and energy-healing content designed for deep relaxation and spiritual restoration. Their unique sensory format and high engagement in the energy-healing space make them a notable competitor in Edward Mannix's niche.",
     SCRAPED_DATE],

    # Lisa Kleyn
    ["Lisa Kleyn", 1, "Doctor Tim MD", "@doctortim.md", url("doctortim.md"), PLATFORM,
     "Doctor Tim MD creates functional medicine and integrative health content for audiences seeking root-cause approaches to chronic illness. His physician credibility and practical health optimization advice place him in direct competition with Lisa Kleyn's functional-medicine brand.",
     SCRAPED_DATE],
    ["Lisa Kleyn", 2, "Jake Goodman MD", "@jakegoodmanmd", url("jakegoodmanmd"), PLATFORM,
     "Jake Goodman MD is a physician sharing accessible mental-health and general wellness content for a broad audience. His doctor-led health education and engagement-focused format compete for the evidence-based wellness audience that Lisa Kleyn targets.",
     SCRAPED_DATE],
    ["Lisa Kleyn", 3, "Dr. Will Cole", "@drwillcole", url("drwillcole"), PLATFORM,
     "Dr. Will Cole is a leading functional medicine practitioner known for his root-cause approach to inflammation, hormones, and chronic disease. His high-traffic content on gut health and functional lab testing places him squarely in Lisa Kleyn's competitive landscape.",
     SCRAPED_DATE],

    # Alli Schaper
    ["Alli Schaper", 1, "Doctor Bing", "@doctor.bing", url("doctor.bing"), PLATFORM,
     "Doctor Bing is a physician-creator focused on sobriety, alcohol-free living, and the science of addiction recovery. Their medically informed content on the health benefits of quitting alcohol directly competes with Alli Schaper's alcohol-free lifestyle brand.",
     SCRAPED_DATE],
    ["Alli Schaper", 2, "Soul of Jaret", "@soulofjaret", url("soulofjaret"), PLATFORM,
     "Soul of Jaret creates personal and spiritual content around sobriety, recovery, and alcohol-free living with an authentic storytelling approach. Their community-focused sobriety content appeals to the same audience of people questioning their relationship with alcohol as Alli Schaper.",
     SCRAPED_DATE],
    ["Alli Schaper", 3, "Suzanne Warye", "@suzannewarye", url("suzannewarye"), PLATFORM,
     "Suzanne Warye is an alcohol-free lifestyle coach sharing content on quitting drinking, sober curiosity, and thriving without alcohol. Her coaching and storytelling approach to the alcohol-free movement places her in direct competition with Alli Schaper's sober-lifestyle brand.",
     SCRAPED_DATE],

    # Dr. Sonia Chopra
    ["Dr. Sonia Chopra", 1, "Dr. Bill Dorfman", "@drbilldorfman", url("drbilldorfman"), PLATFORM,
     "Dr. Bill Dorfman is a celebrity cosmetic dentist and one of the most recognized names in dental aesthetics, with a massive Instagram following built on smile transformations and dental education. His high-profile patient roster and media presence make him a top-tier competitor in the cosmetic dentistry space.",
     SCRAPED_DATE],
    ["Dr. Sonia Chopra", 2, "TheBentist", "@thebentistofficial", url("thebentistofficial"), PLATFORM,
     "TheBentist is a dentist-creator known for engaging educational content that demystifies dental procedures for a mainstream audience. His entertaining and informative reels on everything from cavities to cosmetic work attract a broad dental-health audience that overlaps with Dr. Sonia Chopra's.",
     SCRAPED_DATE],
    ["Dr. Sonia Chopra", 3, "Dr. Remon Raouf", "@drremonraouf", url("drremonraouf"), PLATFORM,
     "Dr. Remon Raouf is a cosmetic dentist specializing in porcelain veneers and smile makeovers, sharing before-and-after transformations and procedure content. His focus on high-end cosmetic dentistry and smile aesthetics places him in direct competition with Dr. Sonia Chopra's brand.",
     SCRAPED_DATE],

    # Henry Ammar
    ["Henry Ammar", 1, "CYCAS Motivation", "@cycasmotivation", url("cycasmotivation"), PLATFORM,
     "CYCAS Motivation is a high-traffic motivational and business-inspiration account delivering quotes, mindset content, and entrepreneurial drive. Their massive reach in the motivation and personal-empowerment space makes them a key competitor for Henry Ammar's inspirational brand.",
     SCRAPED_DATE],
    ["Henry Ammar", 2, "Jay Jay Douglas", "@jayjaydouglas", url("jayjaydouglas"), PLATFORM,
     "Jay Jay Douglas is a motivational speaker and personal-development content creator with a large following drawn to his high-energy storytelling and life-transformation message. His authentic, story-driven motivational content directly competes with Henry Ammar's inspirational coaching brand.",
     SCRAPED_DATE],
    ["Henry Ammar", 3, "HONIA KADER", "@iamhoniakader", url("iamhoniakader"), PLATFORM,
     "HONIA KADER is a personal brand and entrepreneurship coach helping women build influential brands and online businesses. Her content on visibility, audience growth, and personal branding overlaps with Henry Ammar's work on purpose-driven success and influence.",
     SCRAPED_DATE],

    # Eben & Annie
    ["Eben & Annie", 1, "Lorin Krenn", "@lorinkrenn", url("lorinkrenn"), PLATFORM,
     "Lorin Krenn is the founder of the Core Method™ and a spiritual relationship coach helping couples deepen intimacy through polarity and presence. His content on sacred partnership and spiritual growth in relationships directly mirrors Eben & Annie's Kabbalah-informed relationship teachings.",
     SCRAPED_DATE],
    ["Eben & Annie", 2, "Nina Rose", "@withninarose", url("withninarose"), PLATFORM,
     "Nina Rose creates relationship and spiritual growth content that blends emotional intelligence, feminine energy, and conscious partnership. Her audience of women seeking deep love and spiritual connection closely overlaps with Eben & Annie's relationship and spiritual-wisdom brand.",
     SCRAPED_DATE],
    ["Eben & Annie", 3, "David Ghiyam", "@davidghiyam", url("davidghiyam"), PLATFORM,
     "David Ghiyam teaches Kabbalah-inspired wisdom on manifestation, relationships, and spiritual transformation to a highly engaged Instagram audience. His teachings on spiritual laws, soulmate relationships, and inner transformation place him in direct competition with Eben & Annie's Kabbalah and conscious-love content.",
     SCRAPED_DATE],

    # Morgan Burton
    ["Morgan Burton", 1, "Amanda Ferguson", "@mrsamandaferguson", url("mrsamandaferguson"), PLATFORM,
     "Amanda Ferguson is a feminine-energy coach helping women step into their power in relationships, business, and life. Her content on feminine embodiment, confidence, and authentic leadership overlaps closely with Morgan Burton's women's empowerment brand.",
     SCRAPED_DATE],
    ["Morgan Burton", 2, "The Alpha Women Club", "@thealphawomenclub", url("thealphawomenclub"), PLATFORM,
     "The Alpha Women Club is a women's empowerment and motivation account sharing quotes, mindset shifts, and success content for ambitious women. Their high-engagement format and focus on female strength and leadership compete for Morgan Burton's empowerment-focused audience.",
     SCRAPED_DATE],
    ["Morgan Burton", 3, "Female Alpha Club", "@femalealphaclub", url("femalealphaclub"), PLATFORM,
     "Female Alpha Club delivers female empowerment, business mindset, and personal-development content for driven women. Their blend of entrepreneurial motivation and women's leadership content places them in direct competition with Morgan Burton's women's empowerment coaching brand.",
     SCRAPED_DATE],

    # Miki Agrawal
    ["Miki Agrawal", 1, "Maggie Baird", "@maggiebaird", url("maggiebaird"), PLATFORM,
     "Maggie Baird is a sustainability activist and social-impact advocate known for her authentic content on environmental consciousness and purpose-driven living. Her high-profile platform and focus on disruptive social change overlap with Miki Agrawal's taboo-breaking entrepreneurship brand.",
     SCRAPED_DATE],
    ["Miki Agrawal", 2, "Going Green Media", "@goinggreenmedia", url("goinggreenmedia"), PLATFORM,
     "Going Green Media creates sustainability and eco-conscious lifestyle content that educates and inspires audiences to make impactful choices. Their focus on social and environmental innovation competes for the conscious-consumer audience that Miki Agrawal cultivates.",
     SCRAPED_DATE],

    # Natalie MacNeil
    ["Natalie MacNeil", 1, "Jamie Sea", "@jamieseaofficial", url("jamieseaofficial"), PLATFORM,
     "Jamie Sea is a women's business coach blending entrepreneurship strategy with nervous-system regulation and embodied leadership. Her content on sustainable business growth and feminine business principles directly competes with Natalie MacNeil's women-entrepreneur coaching brand.",
     SCRAPED_DATE],
    ["Natalie MacNeil", 2, "Baddie in Biz", "@baddieinbiz", url("baddieinbiz"), PLATFORM,
     "Baddie in Biz (Isabella Kotsias) creates content for women building online businesses, covering digital products, social media strategy, and financial freedom. Her highly engaged community of women entrepreneurs overlaps directly with Natalie MacNeil's audience.",
     SCRAPED_DATE],

    # Erica Matluck
    ["Erica Matluck", 1, "Dr. Amy Shah", "@dramyshah", url("dramyshah"), PLATFORM,
     "Dr. Amy Shah is a double board-certified physician and wellness expert specializing in holistic health, hormones, and functional medicine for women. Her massive reach and focus on integrative medicine for women make her a top competitor in Erica Matluck's holistic-doctor space.",
     SCRAPED_DATE],
    ["Erica Matluck", 2, "Dr. Josh Axe", "@drjoshaxe", url("drjoshaxe"), PLATFORM,
     "Dr. Josh Axe is a functional medicine doctor and clinical nutritionist known for evidence-backed content on natural health, gut healing, and root-cause medicine. His broad holistic health audience and integrative approach directly compete with Erica Matluck's functional and energetic medicine brand.",
     SCRAPED_DATE],
]

output = io.StringIO()
writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL)
writer.writerow(["client_name", "rank", "competitor_name", "competitor_handle",
                 "competitor_url", "platform", "summary", "scraped_date"])
for row in ROWS:
    writer.writerow(row)

print(output.getvalue(), end="")
