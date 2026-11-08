# Web Vitals Inspector

Firefox add-on that adds a Web Vitals panel to the developer tools (F12). It measures Largest Contentful Paint (LCP), Interaction to Next Paint (INP), Cumulative Layout Shift (CLS), First Contentful Paint (FCP) and Time to First Byte (TTFB) on the sites you enable, and shows the elements behind each score.

## Features

- Cards for LCP, INP, CLS, FCP and TTFB, colored by the Core Web Vitals thresholds
- Every layout shift listed with its score, time and the elements that moved, including how far
- The 20 slowest interactions listed with the element that was clicked or typed in
- Click any element in the panel to scroll to it and outline it on the page
- Off by default, enabled per site

## Usage

1. Open the site to test and press F12
2. Open the **Web Vitals** panel
3. Click **Enable on this site**. The page reloads and recording starts from the first paint

**Reset** clears the recorded shifts and interactions without reloading.

## How the metrics are measured

LCP, FCP, TTFB and INP come from Firefox's own performance APIs (`PerformanceObserver`, Navigation Timing and Event Timing). INP needs Firefox 144 or later.

Firefox does not report layout shifts natively. The add-on compares element positions frame by frame and scores them following the [Layout Instability specification](https://wicg.github.io/layout-instability):

- An element counts as shifted when it moves 3 px or more both in the viewport and in the page. Scrolling and fixed elements are not counted
- Running animations and scrolled containers are skipped
- Shifts within 500 ms of a click or key press are shown but not counted
- CLS is the largest session window of shifts (1 second gap, 5 second maximum)

Results can differ slightly from Chrome and PageSpeed Insights where Firefox lays out a page differently.

## Install from source

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on...** and select `manifest.json`

The add-on stays loaded until Firefox restarts.

## Privacy

Nothing leaves the browser. There are no network requests, no analytics and no remote code. The list of enabled sites is kept in the add-on's local storage.

## Licence

© 2026 [HeekDevelopment](https://heekdevelopment.com/). All rights reserved.
