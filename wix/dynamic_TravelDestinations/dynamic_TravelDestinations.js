import wixData from 'wix-data';

$w.onReady(function () {

    $w("#dynamicDataset").onReady(() => {
     let itemObj = $w("#dynamicDataset").getCurrentItem();
        if (itemObj.travelNotes) {
            $w("#travelinformationcolumn").expand();
                   }


        const currentItem = $w("#dynamicDataset").getCurrentItem();
        const currentId = currentItem._id;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const filter = wixData.filter()
            .hasSome("destination_reference", [currentId]) 
            .ge("start_date", today);

        $w("#dataset1")
            .setFilter(filter)
            .then(() => {

                console.log("Filter applied");

                // optional but helpful
                return $w("#dataset1").refresh();

            })
            .then(() => {

                console.log("Dataset refreshed");

            })
            .catch((err) => {

                console.log(err);

            });

    });

});