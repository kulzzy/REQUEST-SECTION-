exports.handler = async function(event) {

    /*
     * Only POST requests are allowed.
     */

    if (event.httpMethod !== "POST") {

        return {
            statusCode: 405,

            headers: {
                "Content-Type":
                    "application/json"
            },

            body: JSON.stringify({

                success: false,

                message:
                    "Method not allowed."

            })
        };

    }


    try {

        /*
         * Get Flutterwave secret key
         * from Netlify environment variables.
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
                        "Payment verification service is not configured."

                })

            };

        }


        /*
         * Read request.
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
         * Transaction ID supplied by Flutterwave.
         */

        const transactionId =
            String(
                data.transaction_id || ""
            ).trim();


        /*
         * Transaction reference.
         */

        const txRef =
            String(
                data.tx_ref || ""
            ).trim();


        /*
         * Service.
         */

        const service =
            String(
                data.service || ""
            ).trim();


        if (!transactionId) {

            return {

                statusCode: 400,

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({

                    success: false,

                    message:
                        "Transaction ID is missing."

                })

            };

        }


        if (!txRef) {

            return {

                statusCode: 400,

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({

                    success: false,

                    message:
                        "Transaction reference is missing."

                })

            };

        }


        /*
         * Determine expected amount
         * on the server.
         */

        let expectedAmount = 0;


        if (
            service ===
            "Celebration Announcement Only"
        ) {

            expectedAmount =
                3000;

        }

        else if (
            service ===
            "Celebration Phone Call Interview"
        ) {

            expectedAmount =
                7000;

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
         * Ask Flutterwave directly
         * to verify the transaction.
         */

        const flutterwaveResponse =
            await fetch(
                `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transactionId)}/verify`,
                {

                    method:
                        "GET",

                    headers: {

                        "Authorization":
                            `Bearer ${secretKey}`,

                        "Content-Type":
                            "application/json"

                    }

                }
            );


        const flutterwaveData =
            await flutterwaveResponse.json();


        /*
         * Flutterwave API itself failed.
         */

        if (!flutterwaveResponse.ok) {

            console.error(
                "Flutterwave verification response:",
                flutterwaveData
            );

            return {

                statusCode: 400,

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({

                    success: false,

                    message:
                        "Flutterwave could not verify this transaction."

                })

            };

        }


        /*
         * Get verified transaction data.
         */

        const transaction =
            flutterwaveData.data;


        if (!transaction) {

            return {

                statusCode: 400,

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({

                    success: false,

                    message:
                        "No transaction information was returned."

                })

            };

        }


        /*
         * CHECK 1:
         *
         * Payment must be successful.
         */

        if (
            transaction.status !==
            "successful"
        ) {

            return {

                statusCode: 400,

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({

                    success: false,

                    message:
                        "Payment was not successful."

                })

            };

        }


        /*
         * CHECK 2:
         *
         * Currency must be NGN.
         */

        if (
            transaction.currency !==
            "NGN"
        ) {

            return {

                statusCode: 400,

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({

                    success: false,

                    message:
                        "Invalid payment currency."

                })

            };

        }


        /*
         * CHECK 3:
         *
         * Amount must match the
         * selected service.
         */

        const paidAmount =
            Number(
                transaction.amount
            );


        if (
            paidAmount <
            expectedAmount
        ) {

            return {

                statusCode: 400,

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({

                    success: false,

                    message:
                        "The payment amount is incorrect."

                })

            };

        }


        /*
         * CHECK 4:
         *
         * The transaction reference
         * must match our reference.
         */

        if (
            transaction.tx_ref !==
            txRef
        ) {

            return {

                statusCode: 400,

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({

                    success: false,

                    message:
                        "Transaction reference does not match."

                })

            };

        }


        /*
         * EVERYTHING PASSED.
         *
         * Payment is verified.
         */

        console.log(
            "KULZZY PAYMENT VERIFIED:",
            {
                transactionId:
                    transaction.id,

                txRef:
                    transaction.tx_ref,

                amount:
                    transaction.amount,

                currency:
                    transaction.currency,

                service:
                    service

            }
        );


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

                message:
                    "Payment successfully verified.",

                transaction_id:
                    transaction.id,

                tx_ref:
                    transaction.tx_ref,

                amount:
                    transaction.amount,

                currency:
                    transaction.currency,

                service:
                    service

            })

        };

    }


    catch(error) {

        console.error(
            "Verify payment error:",
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
                    "Unable to verify payment at this time."

            })

        };

    }

};
