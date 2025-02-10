import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import { exec } from 'child_process';

dotenv.config();

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// Helper Functions

// Preprocess text: Clean and normalize
const preprocessText = (text) => {
  console.log("Step 1: Preprocessing text...");
  return text.replace(/\s+/g, ' ').trim();
};

// Extract entities and split into chunks using spaCy
// async function extractEntitiesWithSpacy(text) {
//   return new Promise((resolve, reject) => {
//     console.log("Step 2: Extracting entities and chunking with spaCy...");
//     exec(`python3 src/spacy2_script.py "${text}"`, (error, stdout, stderr) => {
//       if (error) {
//         console.error("Error in spaCy script:", error.message);
//         reject(error.message);
//       } else if (stderr) {
//         console.error("spaCy stderr:", stderr);
//         reject(stderr);
//       } else {
//         try {
//           console.log("Extracted Entities:", stdout);
//           resolve(JSON.parse(stdout));
//         } catch (err) {
//           console.error("Error parsing spaCy output:", err);
//           reject("Parsing error in spaCy output");
//         }
//       }
//     });
//   });
// }


const prompt = (text) => {
  return `This is the text: ${text}. I want a summary of the text as an arraylist back in the following form. Do not write any additional text, just give me the arraylist: I want you to extend and enhance this list with contents from the article. Here are the descriptions of the attributes: [entity name; entity description; status or group of the entity; references to one or more other entities created that resemble superordinate concepts or entities like a parent-child relationship or a whole-part relationship,where always the bigger or superordinate is represented; a list of tuples that consist of one reference to another created entity and a matching description where dynamics and relationships that are not hierarchical should be described for example the way one entity changes another one; references to entities that result out of the current entity so that a sequence of events is described].
  
  Try to not assign many statuses, but rateher give the same status to several entities. An object can have several parents. An object can reference several sequence objects. Make sure to work out sequences that are not back-referencing but have a clear direction over several entities. Here is an example so you have an idea, how the form could look like:
  "[
      {
          "name": "car",
          "description": "A wheeled motor vehicle used for transportation, typically powered by an internal combustion engine or an electric motor, designed to carry a small number of passengers.",
          "status": "transportation mode",
          "parents": ["transportation", "vehicle"],
          "relations": [
              ["engine", "Powered by either internal combustion engines or electric motors"],
              ["hybrid_car", "Uses both traditional and electric propulsion systems"],
              ["autonomous_vehicle", "Can function independently without a human driver"],
              ["electric_vehicle", "Powered exclusively by electricity"],
              ["chassis", "Supports the structure and components of the car"]
          ],
          "sequence": ["fast transportation", "long distance connectivity"]

`}

const extractEntitiesPrompt = (text) => {
  return `Extract exactly 15 key entities from the text below.
Return your answer as a valid JSON array with exactly 15 objects.
Each object must have the keys "name", "description", "tag" (all string values).
Do not include any extra text, comments, or markdown formatting.

Text: "${text}"

Example output:
[
  {"name": "Entity 1", "description": "Description of entity 1", "tag": "tag1"},
  {"name": "Entity 2", "description": "Description of entity 2", "tag": "tag2"},
  ...
]
`;
};




const relationsPrompt = (entities, text) => {
  return ` For each entity in ${entities.map(e => e.name).join(', ')} give at least 5 relationships to other entities that are important based on the ${text}. Tag each relationship with one of the following tags:

- hierarchical: for references to other entities that resemble superordinate concepts or entities like a parent-child       relationship or a whole-part relationship where always the bigger or superordinate is represented


- dynamic: for references to other entities that resemble dynamics and relationships that are not hierarchical like for example the way one entity changes another one

- sequence: references to other entities that emerge out of the current entity so that a sequence of events is described.



give the answer in the following form:

[entity name:
  [relation entity 1; description, tag],
  [relation entity 2; description, tag], ...

]


Give at least 5 relationships for each entity in the list!

`;
};










// const relationsPrompt = (entity, entities, text) => {
//   return `Analyze the relationships between ${entity} and each entity in the following list:
// ${entities.map(e => e.name).join(', ')}
// Based on the context: "${text}"
// For each relationship return:
// - entity name,
// - A description of the relationship,
// - The type of relationship (choose one of: hierarchical, dynamic, sequential).

// `;
// };




// 4a. Function to call LLM for entity extraction
async function extractEntitiesLLM(text) {
  try {
    console.log("Step 3a: Fetching entity extraction from LLM");
    const response = await axios.post('http://localhost:11434/api/generate', {
      model: 'llama3',
      prompt: extractEntitiesPrompt(text),
      stream: false,
      temperature: 0.1
    });
    console.log("LLM entity response:", response.data);
    // Parse the LLM response into a JSON array of entity objects.
    // (Implement your parsing logic here based on the LLM output.)
    const entities = parseEntities(response.data.response);
    return entities;
  } catch (error) {
    console.error('Error during entity extraction:', error);
    throw new Error('Entity extraction failed');
  }
}

// 4b. Function to call LLM for relationship extraction
async function extractRelationships(entities, text) {
  try {
    console.log("Step 3b: Fetching relationship extraction from LLM");
    const response = await axios.post('http://localhost:11434/api/generate', {
      model: 'llama3',
      prompt: relationsPrompt(entities, text),
      stream: false,
      temperature: 0.1  
    });
    // console.log("LLM relationships response:", response.data);
    // Parse the relationship output into a structured array of objects.
    // (Implement your parsing logic here based on the LLM output.)
    // const relationships = parseRelationships(response.data.response);
    const relationships = response.data.response;
    return relationships;
  } catch (error) {
    console.error('Error during relationship extraction:', error);
    throw new Error('Relationship extraction failed');
  }
}

// 5. Build the final JSON structure from entities and relationships
function buildFinalJson(entities, relationships) {
  // Initialize each entity’s final object with empty arrays.
  const finalEntities = {};
  entities.forEach(e => {
    finalEntities[e.name] = {
      name: e.name,
      description: e.description,
      status: e.tag,   // using the extracted tag as status
      parents: [],
      relations: [],
      sequence: []
    };
  });

  // Process each relationship object
  relationships.forEach(rel => {
    // Normalize the relationship object to our expected keys:
    const entityA = rel.entityA || rel["Entity1"];
    const entityB = rel.entityB || rel["Entity2"];
    // Normalize the relationship type, ensuring we can safely call toLowerCase()
    const rawType = rel.type || rel["Type"] || "";
    const type = rawType.toLowerCase();
    const description = rel.description || rel["Relationship"] || "";

    // Skip this relationship if any required field is missing
    if (!entityA || !entityB || !type) {
      return;
    }

    if (type === 'hierarchical') {
      // For a hierarchical relationship, assume entityA is the parent and entityB is the child.
      if (finalEntities[entityB]) {
        finalEntities[entityB].parents.push(entityA);
      }
    } else if (type === 'dynamic') {
      // For dynamic, add reciprocal relations.
      if (finalEntities[entityA]) {
        finalEntities[entityA].relations.push([entityB, description]);
      }
      if (finalEntities[entityB]) {
        finalEntities[entityB].relations.push([entityA, description]);
      }
    } else if (type === 'sequential') {
      // For sequential, assume entityA comes before entityB.
      if (finalEntities[entityA]) {
        finalEntities[entityA].sequence.push([entityB, description]);
      }
    }
  });

  return Object.values(finalEntities);
}






function parseEntities(llmResponse) {
  try {
      // Attempt to directly parse the response
      try {
          return JSON.parse(llmResponse);
      } catch (e) {
          // If direct parsing fails, attempt to extract the JSON array
          const jsonString = llmResponse.substring(
              llmResponse.indexOf('['),
              llmResponse.lastIndexOf(']') + 1
          );
          return JSON.parse(jsonString);
      }
  } catch (error) {
      console.error("Error parsing entities:", error);
      throw error;
  }
}




// function parseRelationships(rawText) {
//   // Find the first '[' and the last ']' in the response.
//   const firstIndex = rawText.indexOf('[');
//   const lastIndex = rawText.lastIndexOf(']');
  
//   if (firstIndex === -1 || lastIndex === -1) {
//     throw new Error("JSON array not found in the relationships response.");
//   }
  
//   // Extract the JSON string portion.
//   const jsonString = rawText.substring(firstIndex, lastIndex + 1);
  
//   try {
//     // Parse the extracted JSON string.
//     return JSON.parse(jsonString);
//   } catch (err) {
//     throw new Error("Error parsing relationships JSON: " + err.message);
//   }
// }





app.post('/process-text', async (req, res) => {
 
 
 
  try {
    console.log("===== New Request Received =====");
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Text input is required' });
    }

    // Preprocess the text.
    const cleanedText = preprocessText(text);



    // const entities = extractEntitiesWithSpacy(cleanedText);

    // console.log(entities);

    // Extract entities using the LLM.
    const entities = await extractEntitiesLLM(cleanedText);
    if (!entities || !Array.isArray(entities) || entities.length === 0) {
      return res.status(500).json({ error: 'No entities extracted.' });
    }

    console.log(entities)







    // Fetch additional details for each entity in parallel
    // const enrichedEntities = await Promise.all(
    //   entities.map(async (entity) => {

    //   console.log(entity.name)

        try {

          // Fetch relationships
          const relationships = await extractRelationships(entities, cleanedText);

          console.log("relations: ", relationships)

          // return {
          //   name: entity.name,
          //   description: entity.description || entity.description,
          //   status: entity.tag || entity.tag,
          //   relationships: relationships || []
          // };
        } catch (err) {
          console.error(`Error processing entity ${entity.name}:`, err);
          return { ...entity, relationships: [], error: "Failed to fetch details" };
        }
      // })
    // );

    console.log("Final response prepared.");
    res.json(relationships);
  } catch (error) {
    console.error('Error during text processing:', error);
    res.status(500).json({ error: 'Processing failed' });
  }
});






// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
