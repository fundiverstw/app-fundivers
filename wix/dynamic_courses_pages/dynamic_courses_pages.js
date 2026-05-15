import wixData from 'wix-data';

$w.onReady(() => {
    $w("#dynamicDataset").onReady(async () => {
        const courseId = $w("#dynamicDataset").getCurrentItem()._id;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        try {
            const { items } = await wixData.query("EO_courses")
                .eq("course_name", courseId)
                .find();

            const upcoming = items
                .filter(item => item.start_date && new Date(item.start_date) >= today)
                .sort((a, b) => new Date(a.start_date) - new Date(b.start_date));

            $w("#eoCourserepeater").rows = upcoming;
        } catch (err) {
            console.log("[dyn-courses] query failed:", err);
        }
    });
});
