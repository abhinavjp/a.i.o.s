export const browserAcceptanceConfig = {
  baseURL: "http://127.0.0.1:4174",
  headless: true,
  viewports: {
    desktop: { width: 1440, height: 960 },
    tablet: { width: 900, height: 900 },
    mobile: { width: 390, height: 844 }
  },
  screenshotDirectory: ".scratch/sarathi-view-replacement/screenshots"
};
