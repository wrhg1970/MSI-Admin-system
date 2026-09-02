const fs = require('fs');
const data = JSON.parse(fs.readFileSync('db_dump.json', 'utf8'));

console.log("--- POLICIES ---");
if (data.policies) {
  data.policies.forEach(p => {
    console.log(`ID: ${p.id} | Name: ${p.name} | Plan: ${p.plan} | Region: ${p.region} | Deductible: ${p.deductible} | CodigoPoliza: ${p.CodigoPoliza || 'N/A'}`);
  });
} else {
  console.log("No policies found in dump.");
}

console.log("\n--- POLICY LETTERS ---");
if (data.letters) {
  data.letters.forEach(l => {
    console.log(`ID: ${l.id} | policyId: ${l.policyId} | language: ${l.language} | title: ${l.title} | benefits count: ${l.benefits ? l.benefits.length : 0}`);
    if (l.benefits && l.benefits.length > 0) {
      console.log(`  First 3 benefits:`);
      l.benefits.slice(0, 3).forEach(b => {
        console.log(`    - ${b.label}: ${b.value}`);
      });
    }
  });
} else {
  console.log("No letters found in dump.");
}
