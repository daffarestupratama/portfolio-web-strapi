import fs from "node:fs";
import path from "node:path";

const appDir = "/opt/strapi-daffa/app";
const envFile = "/opt/strapi-daffa/.seed.env";
const dryRun = process.argv.includes("--dry-run");

function loadEnv(file) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    process.env[key] = value;
  }
}

loadEnv(envFile);

const BASE_URL = process.env.STRAPI_URL?.replace(/\/$/, "");
const TOKEN = process.env.STRAPI_TOKEN;

if (!BASE_URL || !TOKEN) {
  console.error("Missing STRAPI_URL or STRAPI_TOKEN in .seed.env");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};

const schemas = {
  project: readSchema("src/api/project/content-types/project/schema.json"),
  article: readSchema("src/api/article/content-types/article/schema.json"),
  tourPackage: readSchema("src/api/tour-package/content-types/tour-package/schema.json"),
  homePage: readSchema("src/api/home-page/content-types/home-page/schema.json"),
  aboutPage: readSchema("src/api/about-page/content-types/about-page/schema.json"),
  tourGuideLandingPage: readSchema("src/api/tour-guide-landing-page/content-types/tour-guide-landing-page/schema.json"),
  skill: readSchema("src/api/skill/content-types/skill/schema.json"),
  experience: readSchema("src/api/experience/content-types/experience/schema.json"),
};

const componentSchemas = readComponentSchemas();

function readSchema(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(appDir, relativePath), "utf8"));
}

function readComponentSchemas() {
  const base = path.join(appDir, "src/components/shared");
  const result = {};

  for (const file of fs.readdirSync(base)) {
    if (!file.endsWith(".json")) continue;
    const schema = JSON.parse(fs.readFileSync(path.join(base, file), "utf8"));
    result[`shared.${file.replace(/\.json$/, "")}`] = schema;
  }

  return result;
}

function endpoint(schema) {
  return schema.kind === "singleType"
    ? `/api/${schema.info.singularName}`
    : `/api/${schema.info.pluralName}`;
}

function paragraphBlocks(text) {
  return String(text)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({
      type: "paragraph",
      children: [{ type: "text", text: p }],
    }));
}

const SKIP = Symbol("skip");

function cleanValue(attr, value, fieldPath) {
  if (value === undefined) return SKIP;
  if (value === null) return null;

  if (attr.type === "blocks") {
    return typeof value === "string" ? paragraphBlocks(value) : value;
  }

  if (attr.type === "enumeration") {
    if (attr.enum?.includes(value)) return value;
    console.warn(`[skip enum] ${fieldPath}: "${value}" not in ${JSON.stringify(attr.enum)}`);
    return SKIP;
  }

  if (attr.type === "component") {
    const componentSchema = componentSchemas[attr.component];
    if (!componentSchema) {
      console.warn(`[skip component] ${fieldPath}: component schema ${attr.component} not found`);
      return SKIP;
    }

    if (attr.repeatable) {
      if (!Array.isArray(value)) return [];
      return value.map((item) => cleanData(componentSchema, item, fieldPath)).filter(Boolean);
    }

    return cleanData(componentSchema, value, fieldPath);
  }

  if (attr.type === "relation") {
    return value;
  }

  return value;
}

function cleanData(schema, raw, label = schema.info?.singularName || "component") {
  const output = {};

  for (const [key, value] of Object.entries(raw)) {
    const attr = schema.attributes[key];

    if (!attr) {
      console.warn(`[skip field] ${label}.${key}: field does not exist in schema`);
      continue;
    }

    const cleaned = cleanValue(attr, value, `${label}.${key}`);
    if (cleaned !== SKIP) output[key] = cleaned;
  }

  return output;
}

async function api(method, pathName, data = undefined) {
  const url = `${BASE_URL}${pathName}`;

  if (dryRun) {
    console.log(`[dry-run] ${method} ${pathName}`);
    if (data) console.log(JSON.stringify(data, null, 2).slice(0, 1200));
    return { data: null };
  }

  const res = await fetch(url, {
    method,
    headers,
    body: data === undefined ? undefined : JSON.stringify({ data }),
  });

  const text = await res.text();
  let parsed;

  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    console.error(`\nNon-JSON response from ${method} ${pathName}`);
    console.error(text.slice(0, 1000));
    throw new Error("Non-JSON response");
  }

  if (!res.ok) {
    console.error(`\nAPI error ${method} ${pathName}`);
    console.error("Status:", res.status);
    console.error(JSON.stringify(parsed, null, 2).slice(0, 2000));
    throw new Error(`API error ${res.status}`);
  }

  return parsed;
}

async function list(schema) {
  const ep = endpoint(schema);
  const urls = [
    `${ep}?pagination[pageSize]=100`,
    `${ep}?pagination[pageSize]=100&status=draft`,
  ];

  const byDocumentId = new Map();

  for (const url of urls) {
    try {
      const result = await api("GET", url);
      const items = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
      for (const item of items) {
        if (item?.documentId) byDocumentId.set(item.documentId, item);
      }
    } catch (err) {
      console.warn(`[warn] could not list ${url}: ${err.message}`);
    }
  }

  return Array.from(byDocumentId.values());
}

async function findByField(schema, field, value) {
  const items = await list(schema);
  return items.find((item) => item?.[field] === value);
}

async function findManyByField(schema, field, values) {
  const items = await list(schema);
  const wanted = new Set(values);
  return items.filter((item) => wanted.has(item?.[field]));
}

async function upsertBySlug(schema, raw) {
  const ep = endpoint(schema);
  const data = cleanData(schema, raw, schema.info.singularName);
  const existing = raw.slug ? await findByField(schema, "slug", raw.slug) : null;

  if (existing?.documentId) {
    console.log(`Updating ${schema.info.displayName}: ${raw.title || raw.slug}`);
    return await api("PUT", `${ep}/${existing.documentId}`, data);
  }

  console.log(`Creating ${schema.info.displayName}: ${raw.title || raw.slug}`);
  return await api("POST", ep, data);
}

async function updateSingle(schema, raw) {
  const ep = endpoint(schema);
  const data = cleanData(schema, raw, schema.info.singularName);
  console.log(`Updating single type: ${schema.info.displayName}`);
  return await api("PUT", ep, data);
}

function connectDocs(docs) {
  const ids = docs.map((doc) => doc?.documentId).filter(Boolean);
  return ids.length ? { connect: ids } : undefined;
}

const projectRaw = {
  title: "Financial Distress Prediction for Indonesian Public Companies",
  slug: "financial-distress-prediction-indonesia-public-companies",
  summary: "A machine learning project focused on predicting financial distress among Indonesian public companies using financial indicators and structured modeling workflows.",
  problem: "Financial distress prediction is important for investors, analysts, and stakeholders because early warning signals can support better decision-making.",
  approach: "This project uses a notebook-based data science workflow, starting from data preparation, feature engineering, exploratory data analysis, model training, evaluation, and interpretation.",
  result: "The project is currently in progress as part of my thesis work. The expected output is a structured machine learning model comparison, clear evaluation metrics, and a portfolio-ready explanation of the data science process.",
  techStack: ["Python", "Jupyter Notebook", "Pandas", "NumPy", "Scikit-learn", "Matplotlib", "PostgreSQL", "Financial Analysis"],
  projectType: "machine_learning",
  projectStatus: "in_progress",
  year: 2026,
  githubUrl: "",
  liveDemoUrl: "",
  dashboardUrl: "",
  isFeatured: true,
  notebookResources: [
    {
      title: "Main Jupyter Notebook",
      kind: "jupyter_notebook",
      url: "",
      embedUrl: "",
      description: "Primary notebook containing the end-to-end workflow for data preparation, modeling, evaluation, and interpretation.",
    },
    {
      title: "Model Evaluation Dashboard",
      kind: "dashboard",
      url: "",
      embedUrl: "",
      description: "Planned interactive dashboard for comparing model performance, feature importance, and prediction outputs.",
    },
  ],
  seo: {
    metaTitle: "Financial Distress Prediction — Data Science Project by Daffa Ilham",
    metaDescription: "A machine learning portfolio project by Daffa Ilham Restupratama focused on predicting financial distress among Indonesian public companies.",
    canonicalUrl: "https://daffa.me/projects/financial-distress-prediction-indonesia-public-companies",
    noIndex: false,
  },
};

const articleRaws = [
  {
    title: "Building a Data Science Portfolio Around Financial Distress Prediction",
    slug: "building-data-science-portfolio-financial-distress-prediction",
    excerpt: "A reflection on turning a thesis topic into a portfolio-ready data science project.",
    body: `My current main data science project focuses on financial distress prediction for Indonesian public companies. Instead of treating the thesis only as an academic requirement, I want to structure it as a portfolio project that clearly shows the full data science workflow: problem framing, data preparation, exploratory analysis, modeling, evaluation, and communication.

The main challenge is not only building a model, but also explaining why the model matters. Financial distress prediction sits at the intersection of finance, business, and machine learning. This makes it useful for showing both technical and analytical thinking.

For the portfolio version, I plan to present the project through notebooks, visualizations, model comparison tables, and a concise explanation of the business context.`,
    category: "data",
    tags: ["data science", "machine learning", "financial distress", "portfolio", "thesis"],
    isFeatured: true,
    publishedDate: "2026-04-30",
    seo: {
      metaTitle: "Building a Data Science Portfolio Around Financial Distress Prediction",
      metaDescription: "A reflection on turning a thesis topic into a portfolio-ready data science project.",
      canonicalUrl: "https://daffa.me/articles/building-data-science-portfolio-financial-distress-prediction",
      noIndex: false,
    },
  },
  {
    title: "Why I Moved from Ghost to a Headless CMS Workflow",
    slug: "why-i-moved-from-ghost-to-headless-cms-workflow",
    excerpt: "A short note on choosing Strapi and Webstudio for a more flexible personal website.",
    body: `I initially explored Ghost as a publishing platform for my personal website. Ghost is comfortable for writing, but I wanted more flexibility in structuring content beyond articles.

My portfolio needs to handle projects, notebook outputs, dashboards, skills, experiences, tour packages, and custom landing pages. This pushed me toward a headless CMS approach, where the content structure is separated from the frontend design.

Strapi gives me a dashboard for managing structured content, while Webstudio gives me a visual way to build the frontend. This setup fits my goal: modern design, flexible content models, and less manual frontend coding for every small visual change.`,
    category: "technology",
    tags: ["strapi", "webstudio", "headless cms", "portfolio", "web development"],
    isFeatured: true,
    publishedDate: "2026-04-30",
    seo: {
      metaTitle: "Why I Moved from Ghost to a Headless CMS Workflow",
      metaDescription: "A short note on choosing Strapi and Webstudio for a more flexible personal website.",
      canonicalUrl: "https://daffa.me/articles/why-i-moved-from-ghost-to-headless-cms-workflow",
      noIndex: false,
    },
  },
  {
    title: "What I Learned from Managing Business Development at COMPFEST",
    slug: "what-i-learned-managing-business-development-compfest",
    excerpt: "Lessons from leading a student-run business development division in a large technology event.",
    body: `Serving as Head of Business Development at COMPFEST taught me that management is often about creating clarity. A division can have many goals, but without clear documentation, ownership, and workflows, execution becomes fragile.

The Business Development division supported several functions, including revenue-generating IT services, official merchandise, and participant souvenirs. Because the work involved multiple sub-functions, I initiated documents and structures to make coordination more manageable.

This experience shaped how I think about operations: good systems help people work better. That mindset also influences how I approach technology projects today, especially when designing data workflows, CMS structures, and portfolio systems.`,
    category: "personal",
    tags: ["leadership", "business development", "student organization", "compfest", "management"],
    isFeatured: true,
    publishedDate: "2026-04-30",
    seo: {
      metaTitle: "What I Learned from Managing Business Development at COMPFEST",
      metaDescription: "Lessons from leading a student-run business development division in a large technology event.",
      canonicalUrl: "https://daffa.me/articles/what-i-learned-managing-business-development-compfest",
      noIndex: false,
    },
  },
  {
    title: "Designing City Tours Around Public Transport and Hidden Stories",
    slug: "designing-city-tours-around-public-transport-hidden-stories",
    excerpt: "How walking tours and public transport can create more grounded ways to experience a city.",
    body: `My approach to city tours focuses on walking, public transport, local food, and historical context. I like tours that make a city feel understandable, not just photogenic.

Instead of only visiting famous landmarks, I want to connect places with stories: why an area developed, how people move through the city, where local communities gather, and what small details are easy to miss.

The tours I plan to offer cover Jakarta, Bogor, Tangerang, and Yogyakarta, with a mix of city history, food, transport, and hidden gems. Some routes may also include nature-based trips around Bogor waterfalls.`,
    category: "travel",
    tags: ["tour guide", "city tour", "public transport", "jakarta", "jogja", "hidden gems"],
    isFeatured: false,
    publishedDate: "2026-04-30",
    seo: {
      metaTitle: "Designing City Tours Around Public Transport and Hidden Stories",
      metaDescription: "How walking tours and public transport can create more grounded ways to experience a city.",
      canonicalUrl: "https://daffa.me/articles/designing-city-tours-around-public-transport-hidden-stories",
      noIndex: false,
    },
  },
];

const tourRaws = [
  {
    title: "Jakarta Public Transport & Old City Walking Tour",
    slug: "jakarta-public-transport-old-city-walking-tour",
    shortDescription: "A city walk exploring Jakarta through public transport, colonial history, local streets, and everyday urban life.",
    description: "This tour is designed for visitors who want to understand Jakarta beyond malls and traffic. We will use public transport and walking routes to explore historical areas, urban transitions, and local stories around the city. The experience combines history, mobility, architecture, street atmosphere, and optional local food stops.",
    duration: "4–5 hours",
    meetingPoint: "MRT / TransJakarta station, final point confirmed after booking.",
    suitableFor: ["first-time visitors", "solo travelers", "students", "urban history enthusiasts", "public transport enthusiasts"],
    notSuitableFor: ["travelers who prefer private car-only tours", "visitors uncomfortable with walking", "visitors with very tight schedules"],
    whatToPrepare: ["comfortable walking shoes", "public transport card or e-money", "water bottle", "hat or umbrella", "cash for snacks"],
    included: ["route planning", "guided explanation", "public transport guidance", "photo stop recommendations"],
    excluded: ["public transport fare", "meals and snacks", "personal expenses", "travel insurance"],
    availabilityNote: "Available by request. Recommended for morning or afternoon slots.",
    isFeatured: true,
    priceOption: [{ title: "Private Walking Tour", price: 250000, currency: "IDR", description: "Starting price for a private guided walking tour. Final price may vary depending on route, group size, and duration." }],
    bookingContact: [{ label: "Book via WhatsApp", url: "https://wa.me/62XXXXXXXXXXX", linkType: "booking", icon: "whatsapp", isPrimary: true, sortOrder: 1 }],
    seo: { metaTitle: "Jakarta Public Transport & Old City Walking Tour", metaDescription: "Explore Jakarta through public transport, walking routes, colonial history, local streets, and hidden urban stories with Daffa.", canonicalUrl: "https://daffa.me/tours/jakarta-public-transport-old-city-walking-tour", noIndex: false },
  },
  {
    title: "Bogor Heritage & Food Walking Tour",
    slug: "bogor-heritage-food-walking-tour",
    shortDescription: "A relaxed walking tour through Bogor’s city atmosphere, heritage areas, local food stops, and everyday public spaces.",
    description: "This tour introduces Bogor through a mix of heritage stories, food culture, and walkable city routes. It is suitable for visitors who want a slower, more conversational way to experience the city while learning about its historical and local context.",
    duration: "3–4 hours",
    meetingPoint: "Bogor Station or another central meeting point confirmed after booking.",
    suitableFor: ["food lovers", "first-time Bogor visitors", "students", "small groups", "slow travel enthusiasts"],
    notSuitableFor: ["visitors who cannot walk for several hours", "travelers looking for a luxury tour"],
    whatToPrepare: ["comfortable shoes", "umbrella or raincoat", "cash for food", "water bottle"],
    included: ["guided walking route", "local context explanation", "food stop suggestions"],
    excluded: ["train fare", "food purchases", "personal expenses"],
    availabilityNote: "Best scheduled in the morning or late afternoon.",
    isFeatured: true,
    priceOption: [{ title: "Small Group Walk", price: 200000, currency: "IDR", description: "Starting price for a guided Bogor walking tour. Food and transport costs are excluded." }],
    seo: { metaTitle: "Bogor Heritage & Food Walking Tour", metaDescription: "A relaxed walking tour through Bogor’s city atmosphere, heritage areas, local food stops, and everyday public spaces.", canonicalUrl: "https://daffa.me/tours/bogor-heritage-food-walking-tour", noIndex: false },
  },
  {
    title: "Tangerang Old Town & Cultural Walking Tour",
    slug: "tangerang-old-town-cultural-walking-tour",
    shortDescription: "A compact cultural walk exploring Tangerang’s old town, local communities, and historical layers.",
    description: "This route focuses on Tangerang’s old town atmosphere, cultural landmarks, local streets, and community stories. It is designed for visitors who enjoy compact city routes and want to see a different side of Greater Jakarta.",
    duration: "3–4 hours",
    meetingPoint: "Tangerang Station or agreed central point.",
    suitableFor: ["culture enthusiasts", "students", "photography hobbyists", "short-trip travelers"],
    notSuitableFor: ["travelers expecting a nature-heavy tour", "visitors who dislike walking in urban areas"],
    whatToPrepare: ["comfortable shoes", "water bottle", "cash", "sun protection"],
    included: ["guided walk", "route planning", "cultural and historical context"],
    excluded: ["transport", "food", "personal expenses"],
    availabilityNote: "Available by request, subject to schedule.",
    isFeatured: false,
    priceOption: [{ title: "Urban Culture Walk", price: 200000, currency: "IDR", description: "Starting price for a compact cultural walking tour in Tangerang." }],
    seo: { metaTitle: "Tangerang Old Town & Cultural Walking Tour", metaDescription: "A compact cultural walk exploring Tangerang’s old town, local communities, and historical layers.", canonicalUrl: "https://daffa.me/tours/tangerang-old-town-cultural-walking-tour", noIndex: false },
  },
  {
    title: "Yogyakarta Student City & Heritage Walking Tour",
    slug: "yogyakarta-student-city-heritage-walking-tour",
    shortDescription: "A personal walking tour of Yogyakarta through student life, heritage streets, local food, and city memories.",
    description: "This tour combines Yogyakarta’s heritage atmosphere with a more personal perspective shaped by my years studying in the city. The route can include student-life areas, historical streets, food stops, and cultural context depending on the visitor’s interests.",
    duration: "4–5 hours",
    meetingPoint: "Central Yogyakarta meeting point confirmed after booking.",
    suitableFor: ["first-time Yogyakarta visitors", "students", "culture enthusiasts", "food lovers"],
    notSuitableFor: ["travelers who prefer car-only sightseeing", "visitors with limited walking ability"],
    whatToPrepare: ["comfortable shoes", "sun protection", "water bottle", "cash for food"],
    included: ["guided walking route", "local story-based explanation", "food and photo stop recommendations"],
    excluded: ["transport", "meals", "entrance tickets if any"],
    availabilityNote: "Available when I am in Yogyakarta. Please confirm schedule before booking.",
    isFeatured: true,
    priceOption: [{ title: "Personal City Walk", price: 250000, currency: "IDR", description: "Starting price for a personalized Yogyakarta walking tour." }],
    seo: { metaTitle: "Yogyakarta Student City & Heritage Walking Tour", metaDescription: "A personal walking tour of Yogyakarta through student life, heritage streets, local food, and city memories.", canonicalUrl: "https://daffa.me/tours/yogyakarta-student-city-heritage-walking-tour", noIndex: false },
  },
  {
    title: "Bogor Waterfall Nature Trip",
    slug: "bogor-waterfall-nature-trip",
    shortDescription: "A nature-focused trip to waterfall areas around Bogor, designed for visitors who want a refreshing escape from the city.",
    description: "This tour is a flexible nature trip focused on waterfall destinations around Bogor. The route depends on weather, accessibility, transport options, and visitor fitness level. It is best for small groups who are comfortable with outdoor conditions and possible route changes.",
    duration: "Half day to full day",
    meetingPoint: "Bogor Station or agreed meeting point.",
    suitableFor: ["nature lovers", "small groups", "outdoor beginners", "city escape travelers"],
    notSuitableFor: ["visitors with mobility limitations", "travelers who dislike wet or muddy paths", "visitors expecting luxury facilities"],
    whatToPrepare: ["comfortable outdoor sandals or shoes", "change of clothes", "waterproof bag", "water bottle", "cash", "rain protection"],
    included: ["route planning", "basic trip guidance", "local transport guidance"],
    excluded: ["transport", "entrance tickets", "meals", "personal outdoor gear", "insurance"],
    availabilityNote: "Subject to weather and local access conditions. Route will be confirmed after discussion.",
    isFeatured: false,
    priceOption: [{ title: "Custom Nature Trip", price: 350000, currency: "IDR", description: "Starting price for a custom waterfall trip. Final price depends on destination, group size, transport, and route complexity." }],
    seo: { metaTitle: "Bogor Waterfall Nature Trip", metaDescription: "A nature-focused trip to waterfall areas around Bogor for visitors who want a refreshing escape from the city.", canonicalUrl: "https://daffa.me/tours/bogor-waterfall-nature-trip", noIndex: false },
  },
];

async function main() {
  console.log("Reading existing manual data...");

  const existingSkills = await list(schemas.skill);
  const existingExperiences = await list(schemas.experience);

  console.log(`Existing skills found: ${existingSkills.length}`);
  console.log(`Existing experiences found: ${existingExperiences.length}`);

  const projectResult = await upsertBySlug(schemas.project, projectRaw);
  const projectDoc = projectResult.data;

  const articleDocs = [];
  for (const raw of articleRaws) {
    const result = await upsertBySlug(schemas.article, raw);
    if (result.data) articleDocs.push(result.data);
  }

  const tourDocs = [];
  for (const raw of tourRaws) {
    const result = await upsertBySlug(schemas.tourPackage, raw);
    if (result.data) tourDocs.push(result.data);
  }

  const featuredSkillNames = [
    "Python",
    "Jupyter Notebook",
    "PostgreSQL",
    "BigQuery",
    "Google Cloud Platform",
    "Strapi",
    "JavaScript",
    "Team Management",
    "Business, Finance & Economics",
  ];

  const featuredExperienceTitles = [
    "Undergraduate Student — Information Systems",
    "Head of Business Development & Startup Academy Staff",
    "Job Fair Staff",
    "Science Track Student",
  ];

  const skillsForHome = existingSkills.filter((s) => featuredSkillNames.includes(s.name));
  const experiencesForHome = existingExperiences.filter((e) => featuredExperienceTitles.includes(e.title));

  await updateSingle(schemas.homePage, {
    fullName: "Daffa Ilham Restupratama",
    headline: "Information Systems Student Exploring Data, Technology, and Real-World Stories",
    subheadline: "I build data-driven projects, structured digital systems, and city-based experiences that connect analytical thinking with practical human context.",
    intro: `I am an Information Systems student at the Faculty of Computer Science, Universitas Indonesia. My interests span data science, business technology, product thinking, and digital content systems.

My current main project focuses on machine learning for financial distress prediction among Indonesian public companies. Beyond data and technology, I also enjoy designing city-based walking tours that combine public transport, history, food, and hidden urban stories.

This website is my personal portfolio: a place to document projects, articles, learning notes, notebooks, and selected experiences.`,
    heroCtaPrimary: { label: "View Projects", url: "/projects", style: "primary", description: "Explore my data science, technology, and portfolio projects." },
    heroCtaSecondary: { label: "Read Articles", url: "/articles", style: "secondary", description: "Read notes on data, technology, career, and city stories." },
    featuredSkills: connectDocs(skillsForHome),
    featuredExperiences: connectDocs(experiencesForHome),
    featuredProjects: connectDocs([projectDoc]),
    featuredArticles: connectDocs(articleDocs.slice(0, 3)),
    seo: {
      metaTitle: "Daffa Ilham Restupratama — Data, Technology & Portfolio",
      metaDescription: "Personal portfolio of Daffa Ilham Restupratama, an Information Systems student at Universitas Indonesia interested in data science, technology, business, and city-based storytelling.",
      canonicalUrl: "https://daffa.me",
      noIndex: false,
    },
  });

  await updateSingle(schemas.aboutPage, {
    title: "About Me",
    subtitle: "I am an Information Systems student who enjoys connecting data, technology, business, and human-centered stories.",
    body: `Hi, I am Daffa Ilham Restupratama, an Information Systems student at the Faculty of Computer Science, Universitas Indonesia.

My academic and professional interests sit at the intersection of data, technology, business, and communication. I enjoy working on structured problems: understanding the context, organizing information, building systems, and communicating the result clearly.

My current main project is a machine learning project for predicting financial distress among Indonesian public companies. Through this project, I aim to develop not only technical modeling skills, but also the ability to explain data science work in a way that is useful for business and decision-making audiences.

Outside academic work, I have been involved in student organizations and large-scale events such as COMPFEST, Educare CSUI, and BEM Fasilkom UI. These experiences helped me develop management, communication, documentation, and cross-functional coordination skills.

I also have a personal interest in cities, public transport, history, local food, and hidden urban stories. That interest led me to design city and walking tour concepts for places such as Jakarta, Bogor, Tangerang, and Yogyakarta.`,
    skills: connectDocs(existingSkills),
    experiences: connectDocs(existingExperiences),
    seo: {
      metaTitle: "About Daffa Ilham Restupratama",
      metaDescription: "Learn more about Daffa Ilham Restupratama, an Information Systems student at Universitas Indonesia interested in data, technology, business, and city storytelling.",
      canonicalUrl: "https://daffa.me/about",
      noIndex: false,
    },
  });

  await updateSingle(schemas.tourGuideLandingPage, {
    title: "City Walking Tours with Daffa",
    subtitle: "Explore Indonesian cities through public transport, local history, food, and hidden stories.",
    intro: `My city tours are designed for travelers who want to understand a place beyond typical tourist stops. I focus on walking routes, public transport, local food, city history, and hidden gems that reveal how people actually experience the city.

The tours currently focus on Jakarta, Bogor, Tangerang, and Yogyakarta. Some routes are urban and history-based, while others explore nature destinations such as waterfalls around Bogor.

Each route can be adjusted based on your interests, walking comfort, schedule, and preferred pace.`,
    featuredTours: connectDocs(tourDocs.filter((t) => ["Jakarta Public Transport & Old City Walking Tour", "Bogor Heritage & Food Walking Tour", "Yogyakarta Student City & Heritage Walking Tour"].includes(t.title))),
    whyChooseMe: [
      "Story-based tours that connect places with context, not just photo stops.",
      "Public transport-friendly routes for a more grounded city experience.",
      "Flexible pacing for solo travelers, students, and small groups.",
      "Local food, history, and hidden gems blended into one route.",
      "Clear communication in Indonesian and English.",
    ],
    primaryCta: {
      label: "Ask for a Custom Tour",
      url: "https://wa.me/62XXXXXXXXXXX",
      style: "primary",
      description: "Send a message to discuss route, schedule, group size, and price.",
    },
    seo: {
      metaTitle: "City Walking Tours in Jakarta, Bogor, Tangerang & Yogyakarta",
      metaDescription: "Book city walking tours with Daffa, focused on public transport, history, food, hidden gems, and local stories in Jakarta, Bogor, Tangerang, and Yogyakarta.",
      canonicalUrl: "https://daffa.me/tour-guide",
      noIndex: false,
    },
  });

  console.log("\nSeed finished.");
  console.log("Open Strapi Admin and check Project, Articles, Tour Packages, Home Page, About Page, and Tour Guide Landing Page.");
  console.log("If Draft & Publish is enabled, publish newly created entries manually from Content Manager.");
}

main().catch((err) => {
  console.error("\nSeed failed:");
  console.error(err);
  process.exit(1);
});
