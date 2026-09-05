exports.handler = async function(event) {

    /*
     * Only POST requests are allowed.
     */

    if (event.httpMethod !== "POST") {

        return {
            statusCode: 405,

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                success: false,
                message: "Method not allowed."
            })
        };

    }


    try {

        /*
         * Check Flutterwave secret key.
         */

        const secretKey =
            process.env.FLW_SECRET_KEY;


        if (!secretKey) {

            console.error(
                "FLW_SECRET_KEY is missing."
            );

            return {
                statusCode: 500,

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({

                    success: false,

                    message:
                        "Payment service is not configured."

                })
            };

        }


        /*
         * Read request body.
         */

        let data;

        try {

            data =
                JSON.parse(
                    event.body || "{}"
                );

        }

        catch(error) {

            return {
                statusCode: 400,

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({

                    success: false,

                    message:
                        "Invalid request data."

                })
            };

        }


        /*
         * Get service.
         */

        const service =
            String(
                data.service || ""
            ).trim();


        /*
         * IMPORTANT:
         *
         * The customer does NOT control
         * the payment amount.
         *
         * The server determines it.
         */

        let amount = 0;


        if (
            service ===
            "Celebration Announcement Only"
        ) {

            amount = 3000;

        }

        else if (
            service ===
            "Celebration Phone Call Interview"
        ) {

            amount = 7000;

        }

        else {

            return {
                statusCode: 400,

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({

                    success: false,

                    message:
                        "Invalid celebration service."

                })
            };

        }


        /*
         * Required customer information.
         */

        const email =
            String(
                data.email || ""
            ).trim();

        const senderName =
            String(
                data.senderName || ""
            ).trim();


        if (!email) {

            return {
                statusCode: 400,

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({

                    success: false,

                    message:
                        "Email address is required."

                })
            };

        }


        if (!senderName) {

            return {
                statusCode: 400,

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({

                    success: false,

                    message:
                        "Sender name is required."

                })
            };

        }


        /*
         * Generate a unique transaction reference.
         *
         * This is generated on the server.
         */

        const timestamp =
            Date.now();

        const randomNumber =
            Math.floor(
                100000 +
                Math.random() * 900000
            );


        const txRef =
            `KULZZY-${timestamp}-${randomNumber}`;


        /*
         * Prepare response.
         *
         * The public key is safe to return.
         *
         * The secret key is NEVER returned.
         */

        const publicKey =
            "FLWPUBK-5307a6454182615bb0f9ef448799d87d-X";


        return {

            statusCode: 200,

            headers: {

                "Content-Type":
                    "application/json",

                "Cache-Control":
                    "no-store"

            },

            body: JSON.stringify({

                success: true,

                publicKey:
                    publicKey,

                tx_ref:
                    txRef,

                amount:
                    amount,

                currency:
                    "NGN"

            })

        };

    }


    catch(error) {

        console.error(
            "Create payment error:",
            error
        );


        return {

            statusCode: 500,

            headers: {

                "Content-Type":
                    "application/json"

            },

            body: JSON.stringify({

                success: false,

                message:
                    "Unable to create payment."

            })

        };

    }

};
