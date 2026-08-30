const WORKSHOP_BIO_DATA = {
  philipp: {
    name: "Dr Philipp Nitschke",
    role: "NMR Lead, Australian National Phenome Centre",
    photo: "assets/philipp-nitschke.jpg",
    bio: "Philipp leads NMR at the ANPC and develops advanced nuclear magnetic resonance methods for high-throughput metabolic phenotyping. His work focuses on quantitative lipoprotein, lipidomic and metabolite profiling, with applications in systemic biomarker discovery for complex disease and inflammatory responses."
  },
  reika: {
    name: "Dr Reika Masuda",
    role: "Lead Bioinformatician, Australian National Phenome Centre",
    photo: "assets/reika-masuda.jpg",
    bio: "Reika leads bioinformatics at the ANPC, applying advanced computational modelling and machine learning to large-scale metabolic and lipidomic datasets. Her research focuses on integrating complex omics data to identify systemic biomarkers linked to cardiovascular risk, infectious disease and inflammatory responses."
  },
  luke: {
    name: "Dr Luke Whiley",
    role: "Senior Lecturer, Curtin University; Adjunct, Australian National Phenome Centre",
    photo: "assets/luke-whiley.png",
    bio: "Luke leads the Lipid and Metabolic Phenotype Group within the Curtin Medical Research Institute and holds an adjunct appointment at the ANPC. His research spans targeted and untargeted LC-MS lipidomics across neurodegeneration, inflammatory injury and large human cohort studies."
  }
};

function openFacilitatorBio(id) {
  const person = WORKSHOP_BIO_DATA[id];
  const modal = document.getElementById("facilitator-modal");
  if (!person || !modal) return;

  const photo = document.getElementById("facilitator-modal-photo");
  const name = document.getElementById("facilitator-modal-name");
  const role = document.getElementById("facilitator-modal-role");
  const bio = document.getElementById("facilitator-modal-bio");

  if (photo) { photo.src = person.photo; photo.alt = person.name; }
  if (name) name.textContent = person.name;
  if (role) role.textContent = person.role;
  if (bio) bio.textContent = person.bio;

  modal.removeAttribute("hidden");
  modal.setAttribute("aria-hidden", "false");
  modal.classList.add("open");
  document.documentElement.classList.add("modal-open");
  document.body.classList.add("modal-open");
}

function closeFacilitatorBio() {
  const modal = document.getElementById("facilitator-modal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  modal.setAttribute("hidden", "");
  document.documentElement.classList.remove("modal-open");
  document.body.classList.remove("modal-open");
}

window.openFacilitatorBio = openFacilitatorBio;
window.closeFacilitatorBio = closeFacilitatorBio;

/* Initial state */
document.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("facilitator-modal");
  if (modal && modal.getAttribute("aria-hidden") !== "false") {
    modal.setAttribute("hidden", "");
  }
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeFacilitatorBio();
});
