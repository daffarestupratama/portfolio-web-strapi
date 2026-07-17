import fs from "node:fs";
import path from "node:path";

const appDir = "/opt/strapi-daffa/app";

const schemaFiles = [
  "src/api/project/content-types/project/schema.json",
  "src/api/article/content-types/article/schema.json",
  "src/api/tour-package/content-types/tour-package/schema.json",
  "src/api/home-page/content-types/home-page/schema.json",
  "src/api/about-page/content-types/about-page/schema.json",
  "src/api/tour-guide-landing-page/content-types/tour-guide-landing-page/schema.json",
];

for (const file of schemaFiles) {
  const fullPath = path.join(appDir, file);
  const schema = JSON.parse(fs.readFileSync(fullPath, "utf8"));

  console.log("\n==================================================");
  console.log(schema.info.displayName);
  console.log("kind:", schema.kind);
  console.log("singularName:", schema.info.singularName);
  console.log("pluralName:", schema.info.pluralName);
  console.log("endpoint:", schema.kind === "singleType"
    ? `/api/${schema.info.singularName}`
    : `/api/${schema.info.pluralName}`
  );
  console.log("fields:");

  for (const [name, attr] of Object.entries(schema.attributes)) {
    const extra = attr.type === "enumeration"
      ? ` enum=${JSON.stringify(attr.enum)}`
      : attr.type === "component"
        ? ` component=${attr.component} repeatable=${!!attr.repeatable}`
        : attr.type === "relation"
          ? ` relation=${attr.relation} target=${attr.target}`
          : "";

    console.log(`- ${name}: ${attr.type}${extra}`);
  }
}
