let htmlData = html;
let ipsData = ips;
let lang = "";  // Default language, will be set by ePI

let getSpecification = () => {
    return "1.0.0";
};

let annotationProcess = (listOfCategories, enhanceTag, document, response) => {
    listOfCategories.forEach((check) => {
        if (response.includes(check)) {
            let elements = document.getElementsByClassName(check);
            for (let i = 0; i < elements.length; i++) {
                elements[i].classList.add(enhanceTag);
                elements[i].classList.add("qt-prolongation-lens");
            }
            if (document.getElementsByTagName("head").length > 0) {
                document.getElementsByTagName("head")[0].remove();
            }
            if (document.getElementsByTagName("body").length > 0) {
                response = document.getElementsByTagName("body")[0].innerHTML;
                console.log("Response: " + response);
            } else {
                console.log("Response: " + document.documentElement.innerHTML);
                response = document.documentElement.innerHTML;
            }
        }
    });

    if (response == null || response == "") {
        throw new Error(
            "Annotation proccess failed: Returned empty or null response"
        );
        //return htmlData
    } else {
        console.log("Response: " + response);
        return response;
    }
}


let annotateHTMLsection = async (listOfCategories, enhanceTag) => {
    let response = htmlData;
    let document;

    if (typeof window === "undefined") {
        let jsdom = await import("jsdom");
        let { JSDOM } = jsdom;
        let dom = new JSDOM(htmlData);
        document = dom.window.document;
        return annotationProcess(listOfCategories, enhanceTag, document, response);
    } else {
        document = window.document;
        return annotationProcess(listOfCategories, enhanceTag, document, response);
    }
};



let enhance = async () => {
    if (!ipsData || !ipsData.entry || ipsData.entry.length === 0) {
        throw new Error("IPS is empty or invalid.");
    }

    // 1. Check Composition.language
    epi?.entry?.forEach((entry) => {
        const res = entry.resource;
        if (res?.resourceType === "Composition" && res.language) {
            lang = res.language;
            console.log("🌍 Detected from Composition.language:", lang);
        }
    });

    // 2. If not found, check Bundle.language
    if (!lang && epi?.language) {
        lang = epi.language;
        console.log("🌍 Detected from Bundle.language:", lang);
    }

    // 3. Fallback
    if (!lang) {
        console.warn("⚠️ No language detected in Composition or Bundle.");
        lang = "en";
    }

    let enhanceTag = "highlight";
    let listOfCategoriesToSearch = [{ "code": "grav-1", "system": "http://gravitate-health.eu/codes" }]; //what to look in extensions -made up code because there is none

    // Highlight <QT prolongation risk> IF MedicationRequest.medication == [Citalopram] 
    // AND Observation.code == "K+" (loinc 2823-3) AND Observation.value < 3.5 mmol/L

    const potassiumCodes = ["2823-3", "6298-4"]; // what to look in IPS Lab
    const citalopramKeywords = ["citalopram", "Citalopram"]; // what to look in medication request / statements
    const citalopramCodes = ["204447", "372729009"];// what to look in medication request / statements

    let hasLowPotassium = false;
    let takingCitalopram = false;

    // Index medications by reference ID
    const medicationsById = new Map();
    ipsData.entry.forEach((entry) => {
        if (entry.resource?.resourceType === "Medication" && entry.resource.id) {
            medicationsById.set(`Medication/${entry.resource.id}`, entry.resource);
        }
    });

    for (const entry of ipsData.entry) {
        const res = entry.resource;
        if (!res) continue;

        // Check potassium
        if (
            res.resourceType === "Observation" &&
            res.code?.coding &&
            typeof res.valueQuantity?.value === "number"
        ) {
            const isK = res.code.coding.some(
                (c) =>
                    potassiumCodes.includes(c.code) ||
                    c.display?.toLowerCase().includes("potassium")
            );
            if (isK && res.valueQuantity.value < 3.5) {
                hasLowPotassium = true;
                console.log("⚠️ Low K+:", res.valueQuantity.value);
            }
        }

        // MedicationStatement or MedicationRequest
        if (["MedicationStatement", "MedicationRequest"].includes(res.resourceType)) {
            let codes = [];

            // Case 1: medicationCodeableConcept
            if (res.medicationCodeableConcept?.coding) {
                codes = res.medicationCodeableConcept.coding;
            }

            // Case 2: medicationReference to Medication resource
            if (res.medicationReference?.reference) {
                const medRef = res.medicationReference.reference;
                const med = medicationsById.get(medRef);
                if (med?.code?.coding) {
                    codes = codes.concat(med.code.coding);
                }
            }

            // Evaluate all found codes
            for (const coding of codes) {
                const matchByCode = citalopramCodes.includes(coding.code);
                const matchByText = citalopramKeywords.some((kw) =>
                    (coding.display || "").toLowerCase().includes(kw)
                );

                if (matchByCode || matchByText) {
                    takingCitalopram = true;
                    console.log("💊 Citalopram matched via code or display:", coding.code);
                    break;
                }
            }
        }
    }


    // ePI traslation from terminology codes to their human redable translations in the sections
    let compositions = 0;
    let categories = [];
    epi.entry.forEach((entry) => {
        if (entry.resource.resourceType == "Composition") {
            compositions++;
            //Iterated through the Condition element searching for conditions
            entry.resource.extension.forEach((element) => {

                // Check if the position of the extension[1] is correct
                if (element.extension[1].url == "concept") {
                    // Search through the different terminologies that may be avaible to check in the condition
                    if (element.extension[1].valueCodeableReference.concept != undefined) {
                        element.extension[1].valueCodeableReference.concept.coding.forEach(
                            (coding) => {
                                console.log("Extension: " + element.extension[0].valueString + ":" + coding.code)
                                // Check if the code is in the list of categories to search
                                if (listOfCategoriesToSearch.some(item => item.code === coding.code && item.system === coding.system)) {
                                    // Check if the category is already in the list of categories
                                    categories.push(element.extension[0].valueString);
                                }
                            }
                        );
                    }
                }
            });
        }
    });
    if (compositions == 0) {
        throw new Error('Bad ePI: no category "Composition" found');
    }

    if (categories.length == 0) {
        // throw new Error("No categories found", categories);
        return htmlData;
    }
    if (hasLowPotassium && takingCitalopram) {
        return await annotateHTMLsection(categories, enhanceTag);
    }
    else {

        console.warn("No QT prolongation risk condition met.");
        return htmlData;
    }

};


function getReport(lang = "en") {
    console.log("Generating report in language:", lang);
    return { message: getExplanation(lang), status: "" };


}

// --- Get user-facing report sentence in the selected language ---
function getExplanation(lang = "en") {
    const explanations = {
        en: "This lens highlights the risk of QT prolongation based on medication and lab results.",
        pt: "Esta lente destaca o risco de prolongamento do intervalo QT com base na medicação e nos resultados laboratoriais.",
        es: "Esta lente resalta el riesgo de prolongación del QT basado en la medicación y los resultados de laboratorio.",
        da: "Denne linse fremhæver risikoen for QT-forlængelse baseret på medicin og laboratorieresultater.",
    };
    return explanations[lang] || explanations.en;
}

// --- Exported API ---
return {
    enhance: enhance,
    getSpecification: getSpecification,
    explanation: (language) => getExplanation(language || lang || "en"),
    report: (language) => getReport(language || lang || "en"),
};
