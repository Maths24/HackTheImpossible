import { useEffect, useState } from "react";
import { MapView } from "./MapView";

export const MainView = () => {
    const operatorPos = [-73.9857, 40.7484]; 

    const [timeString, setTimeString] = useState("");

    useEffect(() => {
        const update = () => setTimeString(new Date().toLocaleDateString());
        update();
        const id = setInterval(update, 1000);
        return () => clearInterval(id);
    }, []);

    return (
        <>
            <div  className="status-bar">
                <div className="status-left">
                    Operator:&nbsp;
                    {operatorPos[1].toFixed(4)}°, {operatorPos[0].toFixed(4)}°
                </div>

                <div className="status-center">
                    DEMO MODE - Simulated Environment
                </div>

                <div className="status-right">
                    {timeString}
                </div>
            </div>

            <MapView/>
        </>
    )
}