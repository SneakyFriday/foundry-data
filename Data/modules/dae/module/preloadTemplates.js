export const preloadTemplates = async function () {
    const templatePaths = [
        "./modules/dae/templates/ActiveEffects.hbs",
        "./modules/dae/templates/DIMEditor.hbs",
        "./modules/dae/templates/DAESheetConfig/Details.hbs",
        "./modules/dae/templates/DAESheetConfig/Duration.hbs",
        "./modules/dae/templates/DAESheetConfig/Changes.hbs",
    ];
    return foundry.applications.handlebars.loadTemplates(templatePaths);
};
