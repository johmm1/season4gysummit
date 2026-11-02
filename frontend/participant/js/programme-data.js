// Y-Summit / GYS 2026 — official programme timetable.
//
// Source: "GYS 2026 Youth Summit • Programme Timetable" (draft PDF).
// To change the programme, edit this file only — programme.js renders it.
//
// Item fields
//   s, e     start / end, 24h "HH:MM" (e may equal s for a single moment, e.g. bed time)
//   t        title
//   type     devotion | worship | meal | break | teaching | revival | sports |
//            ceremony | social | admin           (drives colour + icon)
//   sub      optional sub-title / theme line
//   ref      optional key scripture      support  optional supporting scripture
//   quote    optional scripture text shown as a quote
//   obj      optional list of objectives / key points
//   emphasis optional highlighted take-away line
//   who      optional list of { n: name, role?: "...", p?: "phone" }
//   team     optional plain-text team / department (no phone)
//   options  optional list of parallel sessions (break-outs, topic buffets…)
//            each: { tag, t, sub?, pts?: [], who?: [{n,p}], quote? }
//   optionsLabel  heading shown above the options
//   fixtures optional list of sports categories whose live fixtures (from the
//            Sports planner) are listed inside this item, e.g. ["Football", "Volleyball"]

export const EVENT = {
  name: "GYS 2026",
  tagline: "Youth Summit • Programme Timetable",
  start: "2026-12-15",
  end: "2026-12-19",
  status: "Draft timetable — times and facilitators may still change.",
  tz: "Africa/Nairobi",
};

export const DAYS = [
  /* ---------------------------------------------------------- DAY 1 */
  {
    id: 1,
    date: "2026-12-15",
    weekday: "Tuesday",
    theme: "Arrival & Consecration",
    items: [
      { s: "09:00", e: "13:00", t: "Registration", type: "admin", team: "Registration team" },
      { s: "13:00", e: "14:00", t: "Lunch", type: "meal" },
      { s: "14:00", e: "18:00", t: "Games", type: "sports", team: "Sports Department", fixtures: ["Football", "Volleyball"] },
      {
        s: "19:00",
        e: "21:00",
        t: "Revival 1 — The Altar of Consecration",
        type: "revival",
        sub: "Discovering Purpose Through Holiness",
        ref: "Romans 12:1–2",
        support: "Genesis 39:2–4",
        obj: [
          "Understand the importance of surrendering one's life to God.",
          "Recognize holiness as a foundation for pursuing God's purpose.",
          "Develop a personal commitment to prayer, the Word and godly living.",
          "Identify habits and influences that hinder spiritual growth.",
          "Embrace consecration as a lifestyle of serving God faithfully.",
        ],
        who: [{ n: "Rev. Dave Muchagi", role: "Youth Chaplain", p: "0720532445" }],
      },
    ],
  },

  /* ---------------------------------------------------------- DAY 2 */
  {
    id: 2,
    date: "2026-12-16",
    weekday: "Wednesday",
    theme: "Discovering Purpose",
    items: [
      { s: "05:00", e: "06:00", t: "Morning Devotion", type: "devotion", team: "Intercessory Team" },
      { s: "06:00", e: "07:00", t: "Breakfast", type: "meal" },
      { s: "07:00", e: "08:00", t: "G4C Band", type: "worship" },
      {
        s: "08:00",
        e: "10:00",
        t: "Discovering Purpose — “The Dream”",
        type: "teaching",
        ref: "Genesis 37:5",
        obj: [
          "Understand what purpose means and its biblical foundation.",
          "Understand the difference between a dream and purpose.",
          "Recognize how life experiences and opportunities can lead to the discovery of purpose.",
          "Identify the barriers that hinder people from discovering and pursuing purpose.",
          "Understand the role of God in discovering purpose.",
        ],
        who: [
          { n: "Mr. Walubengo" },
          { n: "Joy", role: "Assistant", p: "0754554922" },
        ],
      },
      { s: "10:00", e: "10:15", t: "Sponsors Time & Announcements", type: "ceremony", team: "MC" },
      { s: "10:15", e: "10:45", t: "Tea Break", type: "break", team: "Canteen" },
      {
        s: "10:45",
        e: "12:45",
        t: "Opening Ceremony",
        type: "ceremony",
        who: [{ n: "Moderator" }, { n: "5 Parish Patrons" }, { n: "Guests" }],
      },
      { s: "13:00", e: "14:00", t: "Lunch", type: "meal" },
      {
        s: "14:00",
        e: "15:30",
        t: "Break-out Sessions",
        type: "teaching",
        sub: "Join the session for your age group",
        optionsLabel: "By age group",
        options: [
          {
            tag: "14–15 · Pre-teens",
            t: "I Am More Than My Circumstances",
            pts: ["My Purpose Map"],
            who: [{ n: "Karanja Thuo", p: "0792520833" }],
          },
          {
            tag: "16–18 · Teens",
            t: "Choosing My Direction",
            pts: ["Making wise decisions", "Choosing friends"],
            who: [{ n: "Rev. Eva Wamwenja", p: "0713494802" }],
          },
          {
            tag: "19–23",
            t: "Purpose Beyond the Classroom",
            pts: ["Career and calling", "Finding work", "Entrepreneurship", "Financial discipline"],
            who: [{ n: "Dr. John Gathuku", p: "0720752628" }],
          },
          {
            tag: "24+",
            t: "Purpose & Influence",
            pts: ["Career and professional growth", "Marriage and family", "Leadership"],
            // NOTE: the draft PDF lists this number with 11 digits (07214311083).
            // Shown as printed, but not made tappable until confirmed.
            who: [{ n: "Dr. Abraham Rugo", p: "07214311083", bad: true }],
          },
        ],
      },
      {
        s: "15:30",
        e: "18:00",
        t: "Sports / Team Building",
        type: "sports",
        sub: "Football • Volleyball",
        fixtures: ["Football", "Volleyball"],
      },
      { s: "18:00", e: "19:00", t: "Supper", type: "meal" },
      {
        s: "19:00",
        e: "21:30",
        t: "Revival 2 — The Fear of the Lord",
        type: "revival",
        sub: "Living a Life of Holiness",
        ref: "Proverbs 8:13",
        obj: [
          "Understand the meaning and importance of the fear of God.",
          "Develop a lifestyle of holiness in a compromising world.",
          "Reject sinful influences and ungodly associations.",
          "Cultivate reverence for God in private and public life.",
          "Commit to living with purity, obedience and accountability.",
        ],
        who: [{ n: "Pastor Raffian", p: "0720880879" }],
      },
      { s: "21:30", e: "21:30", t: "Bed Time", type: "break" },
    ],
  },

  /* ---------------------------------------------------------- DAY 3 */
  {
    id: 3,
    date: "2026-12-17",
    weekday: "Thursday",
    theme: "Tested & Set Ablaze",
    items: [
      { s: "05:00", e: "06:00", t: "Morning Devotion", type: "devotion", team: "Intercessory Team" },
      { s: "06:00", e: "07:00", t: "Breakfast", type: "meal" },
      { s: "07:00", e: "08:00", t: "G4C Band", type: "worship" },
      {
        s: "08:00",
        e: "10:00",
        t: "The Test of Purpose",
        type: "teaching",
        ref: "Genesis 39:9",
        obj: [
          "Understand the meaning of integrity.",
          "Understand how character is tested.",
          "Learn practical ways of overcoming tests and temptations associated with purpose.",
          "Understand how to build strong values that can withstand pressure.",
          "Understand that God sees our choices even under pressure.",
          "Learn from Joseph's example of remaining faithful to God despite temptation.",
        ],
        emphasis: "Flee from sexual immorality and maintain purity while pursuing God's purpose.",
        who: [{ n: "Rev. Dr. Moses Thairu", p: "0714381147" }],
      },
      { s: "10:00", e: "10:15", t: "Announcements & Sponsors", type: "ceremony", team: "MC" },
      { s: "10:15", e: "10:45", t: "Tea Break / Health Break", type: "break", team: "Canteen" },
      {
        s: "10:45",
        e: "12:45",
        t: "Ladies & Gents Topic Groups",
        type: "teaching",
        sub: "Join the group for your category",
        optionsLabel: "Choose your group",
        options: [
          {
            tag: "Ladies · Group 1 · Grade 10 – 35 yrs",
            t: "The Woman Beyond Limits",
            quote: "“She is clothed with strength and dignity; she can laugh at the days to come.” — Proverbs 31:25",
            pts: [
              "Discover their identity in Christ",
              "Overcome limitations with courage",
              "Discover and nurture their God-given gifts",
              "Embrace purity and godly values",
            ],
          },
          {
            tag: "Gents · Group 1 · Grade 10 – 18 yrs",
            t: "The Man in Making",
            quote: "“And Jesus grew in wisdom and stature, and in favour with God and man.” — Luke 2:52",
            pts: [
              "Build a godly identity",
              "Develop discipline and self-control",
              "Resist peer pressure and temptation",
              "Grow in wisdom and responsibility",
            ],
            who: [{ n: "Joseph Ndege", p: "0723286053" }],
          },
          {
            tag: "Gents · Group 2 · Collegers 24+",
            t: "The Structured Man",
            quote: "“By wisdom a house is built, and through understanding it is established.” — Proverbs 24:3",
            pts: [
              "Develop vision and intentional planning",
              "Practise financial discipline and stewardship",
              "Demonstrate maturity and godly leadership",
              "Pursue purpose with commitment and diligence",
            ],
            who: [{ n: "Mr. Perminuis Kariuki", p: "0712214385" }],
          },
        ],
      },
      { s: "12:45", e: "14:00", t: "Lunch", type: "meal" },
      {
        s: "14:00",
        e: "15:30",
        t: "Topic Buffets",
        type: "teaching",
        sub: "Pick the topic that fits you",
        optionsLabel: "Pick one",
        options: [
          { tag: "Topic", t: "Career Paths & Career Development" },
          {
            tag: "Topic",
            t: "AI & Networking Capitalization",
            who: [{ n: "Victor Muriithi", p: "0703485057" }],
          },
          {
            tag: "Training",
            t: "Ajira Training",
            who: [{ n: "Harun", p: "0725013511" }],
          },
          { tag: "Topic · 24+", t: "Finance and Investment" },
        ],
      },
      {
        s: "15:30",
        e: "17:30",
        t: "Sports / Team Building",
        type: "sports",
        sub: "Football • Volleyball",
        fixtures: ["Football", "Volleyball"],
      },
      { s: "18:00", e: "19:00", t: "Supper", type: "meal" },
      {
        s: "20:30",
        e: "21:30",
        t: "Revival 3 — Set Ablaze for God",
        type: "revival",
        sub: "Sustaining Spiritual Revival",
        ref: "2 Timothy 1:6–7",
        obj: [
          "Rekindle passion for God and His Word.",
          "Cultivate a life led by the Holy Spirit.",
          "Develop consistency in prayer, worship and fellowship.",
          "Become agents of spiritual revival in the Church and community.",
          "Commit to sustaining spiritual growth beyond the summit.",
        ],
        who: [{ n: "Rev. Nahashon" }],
      },
      { s: "21:30", e: "21:30", t: "Announcements / Bed Time", type: "break" },
    ],
  },

  /* ---------------------------------------------------------- DAY 4 */
  {
    id: 4,
    date: "2026-12-18",
    weekday: "Friday",
    theme: "Purpose in Action",
    banner: { icon: "fa-shirt", text: "Outfit: Jersey Friday — wear your team jersey!" },
    items: [
      { s: "05:00", e: "06:00", t: "Morning Devotion", type: "devotion" },
      { s: "06:00", e: "07:00", t: "Breakfast", type: "meal" },
      { s: "07:00", e: "08:00", t: "G4C Band", type: "worship" },
      {
        s: "08:00",
        e: "10:00",
        t: "Purpose Activation",
        type: "teaching",
        obj: [
          "Help young people move from discovering purpose to taking action.",
          "Recognize opportunities to use their gifts, talents and abilities.",
          "Develop a mindset of courage, discipline and intentional action.",
          "Challenge every participant to identify practical steps towards fulfilling their purpose.",
          "Recognize that purpose requires responsibility and stewardship.",
        ],
        who: [{ n: "Joe Mwangi" }, { n: "Nyoro" }],
      },
      { s: "10:00", e: "10:15", t: "Announcements & Sponsors", type: "ceremony" },
      { s: "10:15", e: "10:45", t: "Tea Break", type: "break" },
      {
        s: "11:00",
        e: "13:00",
        t: "Holy Communion & Closing Ceremony",
        type: "ceremony",
        who: [{ n: "Clerk of the Presbytery" }, { n: "5 Parish Patrons" }],
      },
      { s: "14:00", e: "16:30", t: "Games Finals", type: "sports", fixtures: ["Football", "Volleyball"] },
      { s: "16:30", e: "17:30", t: "Colour Fest", type: "social" },
      { s: "17:30", e: "18:30", t: "Supper", type: "meal" },
      {
        s: "19:00",
        e: "24:00",
        t: "The Talent Show Night",
        type: "social",
        sub: "Folk Songs • Dance • Mr & Miss",
        team: "Judges",
        fixtures: ["Folk Song", "Dance"],
      },
    ],
  },

  /* ---------------------------------------------------------- DAY 5 */
  {
    id: 5,
    date: "2026-12-19",
    weekday: "Saturday",
    theme: "Departure",
    items: [
      { s: "06:00", e: "07:00", t: "Breakfast", type: "meal" },
      { s: "07:00", e: "08:00", t: "Clearance", type: "admin" },
    ],
  },
];
